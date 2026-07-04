#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { stderr, stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { BIN_NAME, helpText, parseArgs } from "./args.js";
import { loadCorpusConfig } from "./config.js";
import { collectTextPaths, readRecords } from "./corpus.js";
import { openCorpus, type Session } from "./core.js";
import { createContainer } from "./cosmos.js";
import { ingestRecords } from "./writer.js";

/**
 * Run one command line at `cwd`, forward its output to the real stdout/stderr,
 * and return the exit code plus the resulting working directory. The session
 * does not persist `cwd` between calls, so the REPL threads it back in.
 */
async function run(session: Session, command: string, cwd: string): Promise<[number, string]> {
    const result = await session.exec(command, { cwd });
    if (result.stdout) {
        stdout.write(result.stdout);
    }
    if (result.stderr) {
        stderr.write(result.stderr);
    }
    return [result.exitCode, result.cwd];
}

/**
 * One-line summary of the connection the session actually resolved to (flag >
 * env > .env > default), so the user can confirm which corpus they are exploring
 * without trusting `.env`, which per-launch overrides may not reflect. The
 * endpoint is shown as its host; `namespace` absent means the whole container.
 */
function connectionLine(config: ReturnType<typeof loadCorpusConfig>): string {
    let host = config.endpoint;
    try {
        host = new URL(config.endpoint).hostname;
    } catch {
        // Keep the raw endpoint if it is not a parseable URL.
    }
    const scope = config.namespace ?? "(whole container)";
    return `connected to ${host}  db=${config.database}  container=${config.container}  namespace=${scope}`;
}

async function repl(session: Session, config: ReturnType<typeof loadCorpusConfig>, showRu: boolean): Promise<void> {
    // Iterating the interface line-by-line ends cleanly on EOF, so it works both
    // for interactive typing (ends on Ctrl-D) and for piped/scripted input
    // (ends when the stream closes) without racing the last command's output.
    const interactive = Boolean(stdin.isTTY);
    const rl = createInterface({ input: stdin, output: stdout, terminal: interactive });
    if (interactive) {
        stdout.write(
            "cosmos-fs — read-only virtual filesystem over the docs corpus.\n" +
            `${connectionLine(config)}\n` +
            "Try: info, ls, cd query, cat overview.md, grep -rn 'partition key' ., find . -name '*.md'.\n" +
            "Type `exit` or press Ctrl-D to quit.\n\n",
        );
        stdout.write("/ $ ");
    }
    let cwd = "/";
    for await (const rawLine of rl) {
        const line = rawLine.trim();
        if (line === "exit" || line === "quit") {
            break;
        }
        if (line !== "") {
            try {
                [, cwd] = await run(session, line, cwd);
            } catch (err) {
                stderr.write(`${(err as Error).message}\n`);
            }
        }
        if (interactive) {
            stdout.write(`${cwd} $ `);
        }
    }
    rl.close();
    if (showRu) {
        writeRuSummary(session);
    }
}

/**
 * One-line session RU total to stderr (diagnostics, never stdout, so it never
 * pollutes parseable output). Prints once the session ends: on REPL exit/EOF and
 * after a one-shot command. The total spans the whole session (startup shape read
 * and tree build plus every `cat`/`grep`), which for a one-shot `-c` run is
 * dominated by the one-time build. Rounded to 2 decimals with trailing zeros
 * dropped (`Number(...toFixed(2))`).
 */
function writeRuSummary(session: Session): void {
    const total = Number(session.ruTotal().toFixed(2));
    stderr.write(`${BIN_NAME}: session used ${total} RU.\n`);
}

/** Read the package version for `--version` (best-effort). */
function readVersion(): string {
    try {
        const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
        return typeof pkg.version === "string" ? pkg.version : "0.0.0";
    } catch {
        return "0.0.0";
    }
}

/** Newest mtime (ms) among top-level files with `ext` in `dir`; 0 if none/unreadable. */
function newestMtime(dir: string, ext: string): number {
    let newest = 0;
    for (const name of readdirSync(dir)) {
        if (name.endsWith(ext)) {
            const m = statSync(join(dir, name)).mtimeMs;
            if (m > newest) {
                newest = m;
            }
        }
    }
    return newest;
}

/**
 * In a dev checkout, warn (once, to stderr) when `src/` is newer than the built
 * `dist/` this binary runs from, so an edit-without-rebuild can't silently run
 * stale code. No-ops in a published package (no sibling `src/`) and when running
 * from source via tsx (entry dir isn't `dist/`). Best-effort: any error is
 * swallowed so the check can never break the tool.
 */
function warnIfStaleBuild(): void {
    try {
        const distDir = dirname(fileURLToPath(import.meta.url));
        if (basename(distDir) !== "dist") {
            return; // running from source (tsx) or an unusual layout
        }
        const srcDir = join(distDir, "..", "src");
        if (!existsSync(srcDir)) {
            return; // published package: nothing to compare against
        }
        if (newestMtime(srcDir, ".ts") > newestMtime(distDir, ".js")) {
            stderr.write(`${BIN_NAME}: warning: src/ is newer than the built dist/ — run \`pnpm build\` (this binary runs dist/).\n`);
        }
    } catch {
        // A dev-only convenience check must never fail the command.
    }
}

/**
 * Handle `cosmos-fs ingest <folder>`: walk the folder for text/markdown, then
 * hand the records to the shared writer, which full-refreshes the namespace and
 * writes canonical items. This is the one writing path; exploring stays
 * read-only. Progress and the final summary go to stderr so stdout stays clean.
 */
async function ingest(folder: string, config: ReturnType<typeof loadCorpusConfig>): Promise<void> {
    const namespace = config.namespace;
    if (!namespace) {
        stderr.write(`${BIN_NAME}: ingest needs a namespace (pass --namespace or set COSMOS_FS_NAMESPACE).\n`);
        process.exit(2);
    }
    const paths = await collectTextPaths(folder);
    if (paths.length === 0) {
        stderr.write(`${BIN_NAME}: no .md/.mdx/.markdown/.txt files found under '${folder}'.\n`);
        process.exit(1);
    }
    const records = await readRecords(folder, paths);
    const container = createContainer(config);
    const { cleared, upserted } = await ingestRecords(container, namespace, records);
    stderr.write(
        `Ingested ${upserted} items into ${config.database}/${config.container} ` +
        `(namespace=${namespace}; cleared ${cleared} existing).\n`,
    );
}

async function main(): Promise<void> {
    warnIfStaleBuild();
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.kind === "help") {
        stdout.write(helpText());
        return;
    }
    if (parsed.kind === "version") {
        stdout.write(`${BIN_NAME} ${readVersion()}\n`);
        return;
    }
    if (parsed.kind === "error") {
        stderr.write(`${BIN_NAME}: ${parsed.message}\n`);
        stderr.write(`Try '${BIN_NAME} --help'.\n`);
        process.exit(2);
    }

    if (parsed.kind === "ingest") {
        await ingest(parsed.folder, loadCorpusConfig(parsed.overrides));
        return;
    }

    const config = loadCorpusConfig(parsed.overrides);
    const session = await openCorpus(config);
    if (parsed.kind === "run") {
        const [exitCode] = await run(session, parsed.command, "/");
        if (parsed.showRu) {
            writeRuSummary(session);
        }
        process.exit(exitCode);
    }
    await repl(session, config, parsed.showRu);
}

/**
 * Turn a thrown error into a one-line, user-facing message. Cosmos/identity
 * errors can be huge multi-line blobs, so we keep only the first line and add a
 * hint for the common auth/RBAC failure so a user (or agent) knows the next step.
 */
function explainError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    const firstLine = message.split("\n", 1)[0] ?? message;
    if (/credential|az login|AADSTS|unauthor|forbidden|\b401\b|\b403\b/i.test(message)) {
        return `${firstLine}\nHint: sign in with \`az login\` and ensure you have Cosmos data-plane RBAC.`;
    }
    return firstLine;
}

main().catch((err: unknown) => {
    // Infra/setup failures (bad config, auth, network) land here. Command
    // failures already exited with the command's own code inside main().
    stderr.write(`${BIN_NAME}: ${explainError(err)}\n`);
    process.exit(1);
});
