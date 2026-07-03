import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { Bash, InMemoryFs } from "just-bash";
import { beforeAll, describe, expect, it } from "vitest";
import { loadIngestConfig } from "../../src/config.js";
import { collectMarkdownPaths } from "../../src/corpus.js";
import { openCorpus, type Session } from "../../src/core.js";

// Integration: hits the real Cosmos account. Run with `pnpm test:integration`.
//
// Differential oracle for grep. The Cosmos shell runs our custom grep (a coarse
// CONTAINS pushdown + fine match delegated to the built-in grep over an
// in-memory copy of the coarse hits); the oracle shell runs the stock built-in
// grep over an InMemoryFs seeded straight from disk. We assert identical stdout
// + exit code, so the coarse->fine optimization must be observationally
// indistinguishable from a plain recursive grep.
//
// Patterns are chosen to exercise each path: literal pushdown (CONTAINS),
// case-insensitivity, per-file listing/counting, single-file reads, the
// fetch-all fallback (regex + inverted match), no-match / missing-file exit
// codes, and stdin filtering (piped `find`/`cat`), where grep must ignore the
// corpus and match the piped bytes instead.
const COMMANDS = [
    "grep -rn Cosmos . | wc -l", // literal pushdown, recursive, line count
    "grep -ri 'partition key' . | wc -l", // case-insensitive multi-word literal
    "grep -rl throughput . | sort", // files-with-matches, sorted
    "grep -rc partition . | sort | tail -5", // per-file counts incl. :0 files
    "grep -n Cosmos overview.md", // single-file read with line numbers
    "grep -rE 'partition.{0,3}key' . | wc -l", // regex metachars -> fetch-all fallback
    "grep -rv Cosmos overview.md | wc -l", // inverted match -> fetch-all fallback
    "grep -r zzznotpresentzzz .", // no match -> empty stdout, exit 1
    "grep partition no-such-file.md", // missing file -> exit 2
    "find . -name '*.md' | grep advisor | sort", // piped: grep filters stdin, not the corpus
    "cat overview.md | grep -n Cosmos", // piped single-page content through grep
    "grep -rwl partition . | sort", // word mode: FTS coarse when indexed, else CONTAINS fallback
    "grep -rw Cosmos . | wc -l", // word mode, line count (whole-word)
];

describe("grep parity: CosmosFs custom grep vs on-disk oracle", () => {
    let cosmos: Session;
    let oracle: Bash;

    beforeAll(async () => {
        const cfg = loadIngestConfig();
        if (!cfg.corpusRoot) {
            throw new Error("Missing CORPUS_ROOT (copy .env.example to .env)");
        }

        // openCorpus is the real engine (src/core.ts) the CLI and agents use;
        // building it here exercises that exact seam, custom grep included.
        cosmos = await openCorpus(cfg);

        const rels = (await collectMarkdownPaths(cfg.corpusRoot)).map((rel) => `/${rel}`);
        const mem = new InMemoryFs();
        for (const abs of rels) {
            await mem.mkdir(posix.dirname(abs), { recursive: true });
            await mem.writeFile(abs, await readFile(join(cfg.corpusRoot, abs.slice(1)), "utf8"));
        }
        oracle = new Bash({ fs: mem, cwd: "/", defenseInDepth: false });
        // Strip the default bin/dev/proc/usr layout so the oracle presents only
        // the corpus (the custom grep strips the same layout in its throwaway).
        await oracle.exec("rm -rf /bin /dev /proc /usr");
    }, 60_000);

    it("finds real matches (guards against vacuous parity)", async () => {
        const { stdout, exitCode } = await cosmos.exec("grep -rl Cosmos .", { cwd: "/" });
        expect(exitCode).toBe(0);
        expect(stdout.trim().length).toBeGreaterThan(0);
    });

    it.each(COMMANDS)("parity: %s", async (cmd) => {
        const a = await cosmos.exec(cmd, { cwd: "/" });
        const b = await oracle.exec(cmd, { cwd: "/" });
        expect(a.stdout).toBe(b.stdout);
        expect(a.exitCode).toBe(b.exitCode);
    });
});
