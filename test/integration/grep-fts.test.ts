import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { Bash, InMemoryFs } from "just-bash";
import { beforeAll, describe, expect, it } from "vitest";
import { loadIngestConfig } from "../../src/config.js";
import { collectMarkdownPaths } from "../../src/corpus.js";
import { openCorpus, type Session } from "../../src/core.js";

// Gated: runs only when COSMOS_FTS=1 and the configured container has a full-text
// index on the content field (create it with the full-text policy, then ingest
// CORPUS_ROOT into it). It exercises the `word` plan's index path specifically:
// `grep -w` routed through the `FullTextContains(All)` coarse filter must be
// byte-identical to a stock `grep -w` over the same corpus on disk. The existing
// grep-parity suite already covers the CONTAINS fallback (a container without the
// index), so this file is the FTS-path counterpart.
//
// Enable:  COSMOS_FTS=1 pnpm test:integration  (with .env pointing at an
// FTS-enabled container whose data was ingested from CORPUS_ROOT).
const RUN = process.env.COSMOS_FTS === "1";

const COMMANDS = [
    "grep -rwl partition . | sort", // single whole word -> FullTextContains
    "grep -rwl 'partition key' . | sort", // phrase -> FullTextContainsAll
    "grep -rw Cosmos . | wc -l", // whole-word line count
    "grep -rwl throughput . | sort",
    "grep -rwc index . | sort | tail -5", // per-file counts incl. :0
    "grep -rwl config . | sort", // no standalone 'config' word: 0 in both
    "grep -rw zzznotpresentzzz .", // no match -> empty stdout, exit 1
];

describe.skipIf(!RUN)("grep -w FTS parity: FullTextContains coarse vs on-disk oracle", () => {
    let cosmos: Session;
    let oracle: Bash;

    beforeAll(async () => {
        const cfg = loadIngestConfig();
        if (!cfg.corpusRoot) {
            throw new Error("Missing CORPUS_ROOT (copy .env.example to .env)");
        }
        cosmos = await openCorpus(cfg);

        const rels = (await collectMarkdownPaths(cfg.corpusRoot)).map((rel) => `/${rel}`);
        const mem = new InMemoryFs();
        for (const abs of rels) {
            await mem.mkdir(posix.dirname(abs), { recursive: true });
            await mem.writeFile(abs, await readFile(join(cfg.corpusRoot, abs.slice(1)), "utf8"));
        }
        oracle = new Bash({ fs: mem, cwd: "/", defenseInDepth: false });
        await oracle.exec("rm -rf /bin /dev /proc /usr");
    }, 60_000);

    it("finds real whole-word matches (guards against vacuous parity)", async () => {
        const { stdout, exitCode } = await cosmos.exec("grep -rwl partition .", { cwd: "/" });
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
