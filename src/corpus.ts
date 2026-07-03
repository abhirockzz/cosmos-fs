import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { CorpusRecord } from "./writer.js";

const MARKDOWN = /\.mdx?$/;
const TEXT = /\.(mdx?|markdown|txt)$/;

/**
 * Recursively collect file paths under `root` matching `pattern`, returned as
 * sorted paths relative to `root` with posix separators (e.g.
 * `query/functions/array-length.md`). Media and hidden directories are skipped.
 */
async function collectPaths(root: string, pattern: RegExp): Promise<string[]> {
    const out: string[] = [];
    async function recurse(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "media" || entry.name.startsWith(".")) {
                    continue;
                }
                await recurse(full);
            } else if (entry.isFile() && pattern.test(entry.name)) {
                out.push(relative(root, full).split(sep).join("/"));
            }
        }
    }
    await recurse(root);
    return out.sort();
}

/**
 * Collect markdown page paths (`.md` / `.mdx`) under `root`. This is the single
 * definition of "what counts as the canonical corpus," shared by the legacy
 * ingest walk and the parity oracle so the two cannot drift apart.
 */
export function collectMarkdownPaths(root: string): Promise<string[]> {
    return collectPaths(root, MARKDOWN);
}

/**
 * Collect text/markdown paths (`.md` / `.mdx` / `.markdown` / `.txt`) under
 * `root` for the `cosmos-fs ingest <folder>` CLI. Broader than the canonical
 * markdown walk; other formats (PDF, etc.) stay at the edge (a user pipeline).
 */
export function collectTextPaths(root: string): Promise<string[]> {
    return collectPaths(root, TEXT);
}

/** First markdown H1, else the key. */
function extractTitle(content: string, fallback: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    return match?.[1]?.trim() ?? fallback;
}

/**
 * Read the given relative paths under `root` into ingest records: `key` = the
 * relative path, `content` = the file text, `title` = the first markdown H1 (or
 * the key). Feeds {@link ingestRecords}.
 */
export async function readRecords(root: string, paths: string[]): Promise<CorpusRecord[]> {
    const records: CorpusRecord[] = [];
    for (const key of paths) {
        const content = await readFile(join(root, key), "utf8");
        records.push({ key, content, title: extractTitle(content, key) });
    }
    return records;
}
