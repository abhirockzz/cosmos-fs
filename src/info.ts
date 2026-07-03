import { type Command, defineCommand } from "just-bash";
import type { CorpusConfig } from "./core.js";
import type { ReaderMapping } from "./mapping.js";
import type { DirTree } from "./tree.js";

/** Host portion of the endpoint for display; falls back to the raw value. */
function hostOf(endpoint: string): string {
    try {
        return new URL(endpoint).hostname;
    } catch {
        return endpoint;
    }
}

/**
 * `info`: print the connection this session actually resolved to (endpoint,
 * database, container, scope), the file count, and how item roles map to
 * fields. It reads the same resolved config/mapping the engine uses, so it can
 * never disagree with what the session is really doing (unlike `.env`, which a
 * per-launch override may not reflect). Registered as a shell command so it
 * works in the REPL, one-shot (`-c "info"`), and pipes alike; it takes no
 * arguments and touches no network, so it is not an injection surface.
 */
export function createInfoCommand(
    config: CorpusConfig,
    mapping: ReaderMapping,
    tree: DirTree,
): Command {
    return defineCommand("info", async () => {
        const scope = mapping.namespace
            ? `${mapping.namespace.value} (${mapping.pinPartition ? "single partition" : "cross-partition"})`
            : "(whole container)";
        const keyField = mapping.keyExpr.replace(/^c\./, "");
        const nsField = mapping.namespace?.field;
        const lines = [
            `endpoint:   ${hostOf(config.endpoint)}`,
            `database:   ${config.database}`,
            `container:  ${config.container}`,
            `namespace:  ${scope}`,
            `files:      ${tree.filePaths().length}`,
            `fields:     content=${mapping.contentField}  key=${keyField}${nsField ? `  namespace=${nsField}` : ""}`,
            `access:     read-only`,
        ];
        return { stdout: `${lines.join("\n")}\n`, stderr: "", exitCode: 0 };
    });
}
