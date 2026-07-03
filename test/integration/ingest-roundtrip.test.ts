import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCorpusConfig } from "../../src/config.js";
import { collectTextPaths, readRecords } from "../../src/corpus.js";
import { type CorpusConfig, openCorpus, type Session } from "../../src/core.js";
import { createContainer } from "../../src/cosmos.js";
import { ingestRecords } from "../../src/writer.js";

// Integration: hits the real Cosmos account. Run with `pnpm test:integration`.
//
// A real ingest -> explore round-trip through the packaged writer path: build a
// tiny local text/markdown folder, run the same walk + write the `ingest`
// subcommand uses (collectTextPaths -> readRecords -> ingestRecords), then open
// the corpus and navigate/read/search it. Writes to a dedicated `roundtrip-fixture`
// namespace in the canonical `pages` container (own partition, full-refreshed each
// run) so it never touches the cosmos-db-nosql corpus.

const NAMESPACE = "roundtrip-fixture";

describe("ingest -> explore round-trip", () => {
    let session: Session;
    let dir: string;

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), "cosmos-fs-ingest-"));
        await mkdir(join(dir, "guide"), { recursive: true });
        await writeFile(join(dir, "overview.md"), "# Overview\nHello world of widgets.");
        await writeFile(join(dir, "guide/intro.md"), "# Intro\nGetting started; mind throughput.");
        await writeFile(join(dir, "notes.txt"), "A plain note mentioning throughput limits.");

        const base = loadCorpusConfig();
        const target = { endpoint: base.endpoint, database: base.database, container: base.container };

        // Exactly what `cosmos-fs ingest <folder>` runs.
        const paths = await collectTextPaths(dir);
        const records = await readRecords(dir, paths);
        const { upserted } = await ingestRecords(createContainer(target), NAMESPACE, records);
        expect(upserted).toBe(3);

        const config: CorpusConfig = { ...target, namespace: NAMESPACE };
        session = await openCorpus(config);
    }, 60_000);

    afterAll(async () => {
        if (dir) {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it("builds the tree from the ingested files (incl. .txt)", async () => {
        const { stdout, exitCode } = await session.exec("find . -type f | sort", { cwd: "/" });
        expect(exitCode).toBe(0);
        expect(stdout.trim().split("\n")).toEqual([
            "./guide/intro.md",
            "./notes.txt",
            "./overview.md",
        ]);
    });

    it("cat reads back the ingested content", async () => {
        const md = await session.exec("cat overview.md", { cwd: "/" });
        expect(md.exitCode).toBe(0);
        expect(md.stdout).toContain("Hello world of widgets.");

        const txt = await session.exec("cat notes.txt", { cwd: "/" });
        expect(txt.stdout).toContain("throughput limits");
    });

    it("grep searches the ingested content across files", async () => {
        const { stdout, exitCode } = await session.exec("grep -rl throughput . | sort", { cwd: "/" });
        expect(exitCode).toBe(0);
        expect(stdout).toContain("guide/intro.md");
        expect(stdout).toContain("notes.txt");
    });
});
