import { existsSync, readFileSync } from "node:fs";
import type { CorpusConfig } from "./core.js";

let dotEnvLoaded = false;

function loadDotEnv(): void {
    if (dotEnvLoaded || !existsSync(".env")) {
        dotEnvLoaded = true;
        return;
    }
    dotEnvLoaded = true;
    // Node (>=20.12) has process.loadEnvFile; a Bun-compiled binary does not, so
    // fall back to a minimal parser. Both mirror loadEnvFile's non-override rule
    // (an already-set env var wins over .env), which the quickstarts rely on.
    if (typeof process.loadEnvFile === "function") {
        process.loadEnvFile(".env");
        return;
    }
    for (const line of readFileSync(".env", "utf8").split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) {
            continue;
        }
        const eq = trimmed.indexOf("=");
        if (eq === -1) {
            continue;
        }
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (key !== "" && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

/** Default startup connect budget (ms) when neither flag nor env sets one. */
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;

/**
 * Resolve the connect timeout from a seconds value (flag/env) to milliseconds.
 * Non-numeric, zero, or negative input falls back to the default rather than
 * disabling the timeout, so a typo can never leave the tool hanging.
 */
function resolveConnectTimeoutMs(raw: string | undefined): number {
    if (raw === undefined || raw.trim() === "") {
        return DEFAULT_CONNECT_TIMEOUT_MS;
    }
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : DEFAULT_CONNECT_TIMEOUT_MS;
}

/**
 * Resolve a required target field (database or container). Unlike the field
 * mapping, these have no default: an unset or blank value throws a clear,
 * actionable error instead of falling back to a fixed name and pointing the
 * user at a container they never chose (which would surface as an empty or
 * wrong corpus).
 */
function requireTarget(value: string | undefined, label: string, envVar: string, flag: string): string {
    if (!value || value.trim() === "") {
        throw new Error(
            `Missing Cosmos ${label}: set ${envVar}, pass ${flag}, or copy .env.example to .env`,
        );
    }
    return value;
}

/**
 * Config for opening/exploring a corpus: which Cosmos account/database/container,
 * which `namespace` (scope) within it, and how the item roles map to fields. This
 * is all the CLI/engine needs — it never depends on how or from where the data was
 * ingested. `overrides` (from CLI flags) take precedence over environment / `.env`
 * / defaults. `namespace` is optional: when unset, the whole container is in scope.
 */
export function loadCorpusConfig(
    overrides: Partial<CorpusConfig> & { connectTimeout?: string } = {},
): CorpusConfig {
    loadDotEnv();
    const endpoint = overrides.endpoint ?? process.env.COSMOS_ENDPOINT;
    if (!endpoint) {
        throw new Error(
            "Missing Cosmos endpoint: set COSMOS_ENDPOINT, pass --endpoint, or copy .env.example to .env",
        );
    }
    const database = requireTarget(
        overrides.database ?? process.env.COSMOS_DATABASE,
        "database",
        "COSMOS_DATABASE",
        "--database",
    );
    const container = requireTarget(
        overrides.container ?? process.env.COSMOS_CONTAINER,
        "container",
        "COSMOS_CONTAINER",
        "--container",
    );
    const namespace = overrides.namespace ?? process.env.COSMOS_FS_NAMESPACE;
    return {
        endpoint,
        database,
        container,
        // Empty/whitespace means "no scope" (whole container), so a user can
        // override a configured COSMOS_FS_NAMESPACE with `--namespace ''` when
        // pointing at a container that isn't scoped by a namespace field.
        namespace: namespace && namespace.trim() !== "" ? namespace : undefined,
        contentField: overrides.contentField ?? process.env.COSMOS_FS_CONTENT_FIELD,
        keyField: overrides.keyField ?? process.env.COSMOS_FS_KEY_FIELD,
        namespaceField: overrides.namespaceField ?? process.env.COSMOS_FS_NAMESPACE_FIELD,
        // Seconds on the wire (flag/env), milliseconds internally.
        connectTimeoutMs: resolveConnectTimeoutMs(overrides.connectTimeout ?? process.env.COSMOS_FS_CONNECT_TIMEOUT),
    };
}

/** Extra config the ingest/admin path needs: the local corpus root to upload. */
export interface IngestConfig extends CorpusConfig {
    corpusRoot: string;
}

/**
 * Config for the ingest script: a corpus target plus `CORPUS_ROOT`, the local
 * directory to walk and upload. The corpus is arbitrary data (docs, code,
 * notes) — only ingest cares about the source; the explore engine does not.
 */
export function loadIngestConfig(): IngestConfig {
    return { ...loadCorpusConfig(), corpusRoot: process.env.CORPUS_ROOT ?? "" };
}
