import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { Bash, InMemoryFs } from "just-bash";
import { beforeAll, describe, expect, it } from "vitest";
import { loadIngestConfig } from "../../src/config.js";
import { collectMarkdownPaths } from "../../src/corpus.js";
import { openCorpus, type Session } from "../../src/core.js";

// Integration: hits the real Cosmos account. Run with `pnpm test:integration`.
//
// Differential oracle for the tree ops. We run the same shell commands against
// two independently-built filesystems and assert identical stdout + exit code:
//   - CosmosFs, whose tree comes from `SELECT VALUE c.key` in Cosmos.
//   - An InMemoryFs seeded from an independent on-disk walk of the corpus.
// Because the oracle is derived straight from disk, its expectations can't be
// overfit. The corpus is markdown-only, so we reuse ingest's own corpus walk
// (collectMarkdownPaths, which skips `media` + hidden dirs) rather than mounting
// the raw directory, which also carries TOC.yml / docfx.json / media assets that
// were never ingested.

const COMMANDS = [
    "ls",
    "ls query",
    "ls query/advisor",
    "ls -R query/advisor",
    "find . -type f | sort",
    "find . -type d | sort",
    "find . -name '*.md' | sort",
    "find query -maxdepth 1 | sort",
    "cd query && pwd",
    "cd query/advisor && ls | sort",
    "cd no-such-dir", // error path: cd's failure differs from ls's
    "cd overview.md", // ENOTDIR: cd into a file
    "ls no-such-dir", // error path: stdout empty, exit code parity
    "[ -f overview.md ] && echo isfile", // stat predicate: file
    "[ -d query ] && echo isdir", // stat predicate: directory
    "[ -f query ] || echo notfile", // stat predicate: dir is not a file
    "cat overview.md", // content read: byte-identical to disk (via the oracle)
    "cat query/advisor/QA1000.md", // content read: a nested page
    "cat overview.md | wc -l", // content piped through a downstream command
    "cat query", // EISDIR: cat a directory -> exit-code parity
    "cat no-such-file.md", // ENOENT: cat a missing file -> exit-code parity
];

describe("tree parity: CosmosFs vs on-disk oracle", () => {
    let cosmos: Session;
    let oracle: Bash;
    let fileCount = 0;

    beforeAll(async () => {
        const cfg = loadIngestConfig();
        if (!cfg.corpusRoot) {
            throw new Error("Missing CORPUS_ROOT (copy .env.example to .env)");
        }

        // The Cosmos-backed shell is the real engine (src/core.ts); building it
        // here exercises the same seam the CLI and agents use.
        cosmos = await openCorpus(cfg);

        const rels = (await collectMarkdownPaths(cfg.corpusRoot)).map((rel) => `/${rel}`);
        fileCount = rels.length;
        const mem = new InMemoryFs();
        for (const abs of rels) {
            await mem.mkdir(posix.dirname(abs), { recursive: true });
            await mem.writeFile(abs, await readFile(join(cfg.corpusRoot, abs.slice(1)), "utf8"));
        }
        oracle = new Bash({ fs: mem, cwd: "/", defenseInDepth: false });
        // Bash seeds InMemoryFs with a default layout (bin/dev/proc/usr) that a
        // custom fs never gets; strip it so both roots present only the corpus.
        await oracle.exec("rm -rf /bin /dev /proc /usr");
    }, 60_000);

    it("corpus is non-empty (guards against vacuous parity)", () => {
        expect(fileCount).toBeGreaterThan(100);
    });

    it.each(COMMANDS)("parity: %s", async (cmd) => {
        const a = await cosmos.exec(cmd, { cwd: "/" });
        const b = await oracle.exec(cmd, { cwd: "/" });
        expect(a.stdout).toBe(b.stdout);
        expect(a.exitCode).toBe(b.exitCode);
    });
});
