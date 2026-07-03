import { beforeAll, describe, expect, it } from "vitest";
import { loadCorpusConfig } from "../../src/config.js";
import { type CorpusConfig, openCorpus, type Session } from "../../src/core.js";
import { createContainer } from "../../src/cosmos.js";

// Integration: hits the real Cosmos account. Run with `pnpm test:integration`.
//
// Read-time field mapping over a FOREIGN-shaped container: a LangChain-style
// store where content lives in `text`, the address in `metadata.source`, and the
// partition key is `/id` (each item its own partition, no namespace scope). This
// proves the reader adapts to data it did not ingest — no re-ingest, just a field
// map — via the resolver + startup key->id index + PK auto-detect.
//
// The `foreign` container (PK `/id`) is provisioned once out of band:
//   COSMOS_CONTAINER=foreign COSMOS_PK=/id COSMOS_THROUGHPUT=400 ./scripts/provision.sh
// The fixture rows below are re-seeded (idempotent upsert) in beforeAll.

const CONTAINER = "foreign";

// LangChain-shaped documents: { id (PK), text, metadata: { source } }. No
// embeddings — cosmos-fs is vector-free; only text + a source path are needed.
const FIXTURE = [
    { id: "doc-overview", text: "# Overview\nWelcome to the guide.", source: "overview.md" },
    {
        id: "doc-oauth",
        text: "# OAuth\nUse OAuth 2.0 to authenticate. Tokens expire.",
        source: "guide/oauth.md",
    },
    {
        id: "doc-setup",
        text: "# Setup\nInstall the CLI and sign in before you start.",
        source: "guide/setup.md",
    },
    {
        id: "doc-api",
        text: "# API\nThe API is organized around partition key routing.",
        source: "reference/api.md",
    },
    {
        id: "doc-errors",
        text: "# Errors\nA 429 means throughput was exceeded; retry with backoff.",
        source: "reference/errors.md",
    },
];

describe("read-time mapping over a foreign (LangChain-shaped) container", () => {
    let session: Session;

    beforeAll(async () => {
        const base = loadCorpusConfig();
        const container = createContainer({
            endpoint: base.endpoint,
            database: base.database,
            container: CONTAINER,
        });
        for (const { id, text, source } of FIXTURE) {
            await container.items.upsert({ id, text, metadata: { source } });
        }

        // Bind our roles to the foreign fields; no namespace -> whole container.
        const config: CorpusConfig = {
            endpoint: base.endpoint,
            database: base.database,
            container: CONTAINER,
            contentField: "text",
            keyField: "metadata.source",
        };
        session = await openCorpus(config);
    }, 60_000);

    it("builds the tree from the mapped key field", async () => {
        const { stdout, exitCode } = await session.exec("find . -type f | sort", { cwd: "/" });
        expect(exitCode).toBe(0);
        expect(stdout.trim().split("\n").sort()).toEqual([
            "./guide/oauth.md",
            "./guide/setup.md",
            "./overview.md",
            "./reference/api.md",
            "./reference/errors.md",
        ]);
    });

    it("lists a subdirectory derived from the mapped key", async () => {
        const { stdout } = await session.exec("ls guide | sort", { cwd: "/" });
        expect(stdout.trim().split("\n")).toEqual(["oauth.md", "setup.md"]);
    });

    it("cat reads the mapped content field via a point read", async () => {
        const { stdout, exitCode } = await session.exec("cat guide/oauth.md", { cwd: "/" });
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Use OAuth 2.0 to authenticate.");
    });

    it("grep searches the mapped content field (coarse CONTAINS pushdown)", async () => {
        const { stdout, exitCode } = await session.exec("grep -rl OAuth .", { cwd: "/" });
        expect(exitCode).toBe(0);
        expect(stdout).toContain("guide/oauth.md");
    });

    it("grep -n reports line numbers in a single mapped file", async () => {
        const { stdout, exitCode } = await session.exec("grep -n 429 reference/errors.md", {
            cwd: "/",
        });
        expect(exitCode).toBe(0);
        expect(stdout).toMatch(/^\d+:.*429/m);
    });
});
