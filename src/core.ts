import type { Container } from "@azure/cosmos";
import type { TokenCredential } from "@azure/identity";
import { Bash } from "just-bash";
import { CosmosFs } from "./cosmos-fs.js";
import { type CosmosTarget, createContainer } from "./cosmos.js";
import { createGrepCommand } from "./grep.js";
import { createInfoCommand } from "./info.js";
import { buildMapping, pkPathToField } from "./mapping.js";
import { RuMeter } from "./ru.js";
import { buildCorpusIndex } from "./tree.js";

/** Everything the explore engine needs: which container, which corpus, and how its fields map. */
export interface CorpusConfig extends CosmosTarget {
    /** Scope value selecting one namespace; absent => the whole container (cross-partition). */
    namespace?: string;
    /** Field holding item text (default `content`). */
    contentField?: string;
    /** Field holding the address/key that builds the tree and `cat` reads (default `key`). */
    keyField?: string;
    /** Field the `namespace` scope filters on (default `namespace`). */
    namespaceField?: string;
}

/** Result of running one command line through a {@link Session}. */
export interface ExecResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    /** Working directory after the command (a successful `cd` moves it). */
    cwd: string;
}

/**
 * A ready-to-use read-only shell over a Cosmos-backed corpus. `exec` runs one
 * command line and returns its output as strings (no process I/O), so the same
 * engine backs the CLI, an agent shelling out, or any other front-end.
 */
export interface Session {
    exec(command: string, options?: { cwd?: string }): Promise<ExecResult>;
    /**
     * Total request units (RU) this session has charged to Cosmos so far: the
     * startup shape read and tree build, plus every `cat` point read and `grep`
     * coarse filter. Structural commands (`ls`/`cd`/`find`) add nothing. The CLI
     * reports this once the session ends.
     */
    ruTotal(): number;
}

/** Default budget (ms) for the startup connectivity probe when config omits one. */
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;

/** Host portion of an endpoint for messages; falls back to the raw value. */
function hostOf(endpoint: string): string {
    try {
        return new URL(endpoint).hostname;
    } catch {
        return endpoint;
    }
}

/**
 * Race a promise against a timeout so an unreachable endpoint fails fast with a
 * clear message instead of hanging on the SDK's internal retries. The timer is
 * unref'd (never keeps the process alive) and the original promise gets a no-op
 * catch so a late rejection (after the timeout already won) won't surface as an
 * unhandledRejection.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
        timer.unref?.();
    });
    promise.catch(() => { });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) {
            clearTimeout(timer);
        }
    });
}

/**
 * Map a raw Cosmos connect failure to a one-line, user-facing message naming the
 * misconfigured piece. A missing database reads as "Owner resource does not
 * exist"; a missing container as "Resource Not Found" — both otherwise surface
 * as opaque JSON blobs. Anything else is returned unchanged for the top-level
 * handler to explain.
 */
function describeConnectError(err: unknown, config: CorpusConfig): Error {
    const message = err instanceof Error ? err.message : String(err);
    if (/Owner resource does not exist/i.test(message)) {
        return new Error(`database '${config.database}' not found on ${hostOf(config.endpoint)} (check --database).`);
    }
    if (/Resource Not Found|cosmosdb-tsg-not-found/i.test(message)) {
        return new Error(
            `container '${config.container}' not found in database '${config.database}' (check --container).`,
        );
    }
    return err instanceof Error ? err : new Error(message);
}

/** What we learn from one `container.read()`: the PK field and any full-text index paths. */
interface ContainerShape {
    pkField: string;
    fullTextIndexPaths: string[];
}

/**
 * Read the container's shape in one metadata call: the partition-key field (so
 * point reads can supply each item's PK value even when the scope is not bound to
 * it) and the full-text index paths (so `grep -w` can use an index-accelerated
 * coarse filter when one covers the content field). v1 supports a single-path PK;
 * hierarchical (multi-path) partition keys are out of scope and throw a clear
 * error rather than silently mis-routing reads.
 */
async function readContainerShape(container: Container, meter?: RuMeter): Promise<ContainerShape> {
    const response = await container.read();
    meter?.add(response.requestCharge);
    const resource = response.resource;
    const paths = resource?.partitionKey?.paths ?? [];
    if (paths.length > 1) {
        throw new Error(
            `Hierarchical partition keys (${paths.join(", ")}) are not supported yet; use a single-path container.`,
        );
    }
    const fullTextIndexPaths = (resource?.indexingPolicy?.fullTextIndexes ?? [])
        .map((index) => index.path)
        .filter((path): path is string => typeof path === "string");
    return { pkField: pkPathToField(paths[0] ?? "/namespace"), fullTextIndexPaths };
}

/**
 * Open a read-only shell session over the corpus in a Cosmos container. It
 * auto-detects the container's partition key, resolves the role→field mapping
 * (defaults, or the caller's bindings for an existing container), then builds
 * the directory tree + point-read index once. The just-bash shell it wires uses
 * that corpus: `ls`/`cd`/`find` resolve from the in-memory tree, `cat` is a point
 * read, and `grep` pushes a coarse filter to Cosmos. Every write throws `EROFS`.
 *
 * The corpus is arbitrary — whatever items exist in the container. The reader
 * assumes only that some field holds text (`content`); `key` (address) and
 * `namespace` (scope) are optional and bindable to whatever fields the data uses.
 */
export async function openCorpus(
    config: CorpusConfig,
    options: { credential?: TokenCredential } = {},
): Promise<Session> {
    const container = createContainer(config, options.credential);
    const timeoutMs = config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    // One meter per session: every Cosmos response below feeds its requestCharge
    // in, and ruTotal() reports the running sum for the CLI to print on exit.
    const meter = new RuMeter();
    let shape: ContainerShape;
    try {
        shape = await withTimeout(
            readContainerShape(container, meter),
            timeoutMs,
            `couldn't reach ${hostOf(config.endpoint)} within ${timeoutMs} ms — check --endpoint and your network, or raise the timeout via COSMOS_FS_CONNECT_TIMEOUT (seconds).`,
        );
    } catch (err) {
        throw describeConnectError(err, config);
    }
    const mapping = buildMapping({
        contentField: config.contentField,
        keyField: config.keyField,
        namespaceField: config.namespaceField,
        namespaceValue: config.namespace,
        pkField: shape.pkField,
        fullTextIndexPaths: shape.fullTextIndexPaths,
    });
    const { tree, refs } = await buildCorpusIndex(container, mapping, meter);
    const bash = new Bash({
        fs: new CosmosFs(tree, container, mapping, refs, meter),
        cwd: "/",
        // Override the built-in grep (which would point-read every page) with a
        // Cosmos coarse-filter + in-memory fine match. See src/grep.ts. `info`
        // reports the resolved connection/mapping so a session can confirm its
        // target from inside the shell (and via `-c "info"`).
        customCommands: [
            createGrepCommand(container, mapping, tree, meter),
            createInfoCommand(config, mapping, tree),
        ],
        // just-bash's defense-in-depth blocks globalThis.setTimeout during command
        // execution; the Cosmos SDK needs it for cat's point read. It is a secondary
        // layer only: the filesystem is read-only (writes throw EROFS) and no
        // network/python/js-exec commands are registered, so commands can't escape.
        defenseInDepth: false,
    });
    return {
        async exec(command, execOptions) {
            const cwd = execOptions?.cwd ?? "/";
            const result = await bash.exec(command, { cwd });
            return {
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                // exec does not persist cwd between calls, so report where a
                // successful `cd` landed for the caller to thread back in.
                cwd: result.env.PWD ?? cwd,
            };
        },
        ruTotal() {
            return meter.total;
        },
    };
}
