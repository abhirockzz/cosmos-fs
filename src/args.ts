/** Canonical binary name, used in help/version/error output. Change here only. */
export const BIN_NAME = "cosmos-fs";

/** Session config a user may override from the command line (flag > env > default). */
export interface ConfigOverrides {
    endpoint?: string;
    database?: string;
    container?: string;
    namespace?: string;
    contentField?: string;
    keyField?: string;
    namespaceField?: string;
}

/**
 * Outcome of parsing argv. A discriminated union so the caller handles each mode
 * explicitly (and errors carry a message instead of throwing).
 */
export type ParsedArgs =
    | { kind: "help" }
    | { kind: "version" }
    | { kind: "run"; command: string; overrides: ConfigOverrides }
    | { kind: "repl"; overrides: ConfigOverrides }
    | { kind: "ingest"; folder: string; overrides: ConfigOverrides }
    | { kind: "error"; message: string };

/** Long flags that set a config override, mapped to their {@link ConfigOverrides} key. */
const VALUE_FLAGS: Record<string, keyof ConfigOverrides> = {
    "--endpoint": "endpoint",
    "--database": "database",
    "--container": "container",
    "--namespace": "namespace",
    "--content-field": "contentField",
    "--key-field": "keyField",
    "--namespace-field": "namespaceField",
};

/**
 * Parse CLI argv (already sliced past `node script`). Pure and total: never
 * throws, never touches the environment — it only classifies intent, so it is
 * fully unit-testable. `--help`/`--version` win regardless of position.
 */
export function parseArgs(argv: string[]): ParsedArgs {
    if (argv.includes("-h") || argv.includes("--help")) {
        return { kind: "help" };
    }
    if (argv.includes("-V") || argv.includes("--version")) {
        return { kind: "version" };
    }

    const overrides: ConfigOverrides = {};
    let command: string | undefined;

    // `ingest <folder>` is a subcommand: the first token selects the writer mode,
    // then a single positional names the local folder to upload.
    const ingestMode = argv[0] === "ingest";
    const tokens = ingestMode ? argv.slice(1) : argv;
    let folder: string | undefined;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i] as string;

        if (!ingestMode && (token === "-c" || token === "--command")) {
            const value = tokens[++i];
            if (value === undefined) {
                return { kind: "error", message: `${token} requires a command` };
            }
            command = value;
            continue;
        }

        // Support both `--flag value` and `--flag=value`.
        let flag = token;
        let inlineValue: string | undefined;
        if (token.startsWith("--") && token.includes("=")) {
            const eq = token.indexOf("=");
            flag = token.slice(0, eq);
            inlineValue = token.slice(eq + 1);
        }
        const key = VALUE_FLAGS[flag];
        if (key !== undefined) {
            const value = inlineValue ?? tokens[++i];
            if (value === undefined) {
                return { kind: "error", message: `${flag} requires a value` };
            }
            overrides[key] = value;
            continue;
        }

        if (token.startsWith("-")) {
            return { kind: "error", message: `unknown option: ${token}` };
        }
        if (ingestMode) {
            if (folder !== undefined) {
                return { kind: "error", message: `unexpected argument: ${token}` };
            }
            folder = token;
            continue;
        }
        return {
            kind: "error",
            message: `unexpected argument: ${token} (did you mean -c "${token}"?)`,
        };
    }

    if (ingestMode) {
        if (folder === undefined) {
            return { kind: "error", message: "ingest requires a folder path" };
        }
        return { kind: "ingest", folder, overrides };
    }

    return command !== undefined
        ? { kind: "run", command, overrides }
        : { kind: "repl", overrides };
}

/** Full `--help` text. This is the primary usage doc; keep it self-contained. */
export function helpText(bin: string = BIN_NAME): string {
    return `${bin} is a read-only shell over a set of documents stored in Azure Cosmos DB.

Explore ingested items (docs, code, notes, any data) with familiar shell
commands. Read-only: every write fails with EROFS.

USAGE
  ${bin}                  Start an interactive shell (REPL).
  ${bin} -c "<command>"   Run one command, print its output, exit with its code.
  ${bin} ingest <folder>  Upload a local text/markdown folder into --namespace.
  ${bin} --help           Show this help.
  ${bin} --version        Show the version.

SHELL COMMANDS
  ls / cd / find          Navigate the document set like files and directories.
  cat <path>              Print an item's full text (a ~1-RU point read).
  grep [-rwinlc] <pat> [p] Search item content; piped input is filtered too.
  grep -w <word>          Whole-word search. Uses the container's full-text index
                          when it has one, so it stays cost effective as the data grows;
                          otherwise it scans. Plain grep does substring and regex.
  Pipes work: cat p | grep x, find . | grep y, ... | head / sort / wc -l.

CONFIG (precedence: flag > env var > .env > default)
  --endpoint <url>        Cosmos account endpoint      (COSMOS_ENDPOINT)
  --database <name>       Database                     (COSMOS_DATABASE, default: docs)
  --container <name>      Container                    (COSMOS_CONTAINER, default: pages)
  --namespace <name>      Document set in the container (COSMOS_FS_NAMESPACE)
  Auth: Azure AD via \`az login\` (DefaultAzureCredential); no keys.

MAPPING (explore an existing container by binding roles to its fields)
  --content-field <path>  Field holding item text      (COSMOS_FS_CONTENT_FIELD, default: content)
  --key-field <path>      Field holding the address    (COSMOS_FS_KEY_FIELD, default: key)
  --namespace-field <path> Field the --namespace value filters on (COSMOS_FS_NAMESPACE_FIELD, default: namespace)
  Paths may be nested (e.g. metadata.source). Omit --namespace to scan the whole
  container. If the mapped key is not the id, or the scope is not the partition
  key, reads/queries cost more but still work.

INGEST (optional writer: load a local folder)
  ${bin} ingest <folder> --namespace <name>
  Walks <folder> for text/markdown (.md/.mdx/.markdown/.txt), uploads one item per
  file (key = relative path), and full-refreshes --namespace first. Other formats
  (PDF, etc.) are handled at the edge: extract to text, then ingest.

EXAMPLES
  ${bin} -c "ls query"
  ${bin} -c "grep -rn 'partition key' ."
  ${bin} -c "grep -rwl throughput ."
  ${bin} -c "cat overview.md | head -20"
  ${bin} --content-field text --key-field metadata.source -c "grep -rl oauth ."
  ${bin} ingest ./docs --namespace my-notes

${bin} turns a Cosmos DB container into a read-only, browsable filesystem.
New here? Start with the quickstarts in docs/quickstarts/.
`;
}
