import { describe, expect, it } from "vitest";
import type { Container } from "@azure/cosmos";
import { buildMapping } from "../../src/mapping.js";
import { RuMeter } from "../../src/ru.js";
import { buildCorpusIndex, DirTree } from "../../src/tree.js";

describe("DirTree", () => {
    const tree = new DirTree([
        "overview.md",
        "query/functions/array-length.md",
        "query/functions/concat.md",
        "query/keywords/where.md",
        "request-units.md",
    ]);

    it("marks the root and intermediate directories as directories", () => {
        expect(tree.isDir("/")).toBe(true);
        expect(tree.isDir("/query")).toBe(true);
        expect(tree.isDir("/query/functions")).toBe(true);
        expect(tree.isDir("/query/keywords")).toBe(true);
        expect(tree.isDir("/overview.md")).toBe(false);
    });

    it("marks leaves as files", () => {
        expect(tree.isFile("/overview.md")).toBe(true);
        expect(tree.isFile("/query/functions/array-length.md")).toBe(true);
        expect(tree.isFile("/query")).toBe(false);
    });

    it("lists sorted children of a directory", () => {
        expect(tree.childrenOf("/")).toEqual(["overview.md", "query", "request-units.md"]);
        expect(tree.childrenOf("/query")).toEqual(["functions", "keywords"]);
        expect(tree.childrenOf("/query/functions")).toEqual(["array-length.md", "concat.md"]);
    });

    it("returns [] for unknown or leaf paths", () => {
        expect(tree.childrenOf("/nope")).toEqual([]);
        expect(tree.childrenOf("/overview.md")).toEqual([]);
    });

    it("has() covers files and dirs but not unknown paths", () => {
        expect(tree.has("/")).toBe(true);
        expect(tree.has("/query")).toBe(true);
        expect(tree.has("/overview.md")).toBe(true);
        expect(tree.has("/missing")).toBe(false);
    });

    it("allPaths lists every dir and file including root, sorted", () => {
        expect(tree.allPaths()).toEqual([
            "/",
            "/overview.md",
            "/query",
            "/query/functions",
            "/query/functions/array-length.md",
            "/query/functions/concat.md",
            "/query/keywords",
            "/query/keywords/where.md",
            "/request-units.md",
        ]);
    });

    it("tolerates leading and trailing slashes in input", () => {
        const t = new DirTree(["/a/b.md", "a/c.md/"]);
        expect(t.isFile("/a/b.md")).toBe(true);
        expect(t.isFile("/a/c.md")).toBe(true);
        expect(t.childrenOf("/a")).toEqual(["b.md", "c.md"]);
    });

    it("ignores empty entries", () => {
        const t = new DirTree(["", "/", "only.md"]);
        expect(t.allPaths()).toEqual(["/", "/only.md"]);
    });
});

// buildCorpusIndex turns one query's rows into the tree + a key->{id,pk} index.
// A fake container returns canned rows so the query-building, key fallback, and
// index wiring are covered offline (no live Cosmos). The full end-to-end mapping
// is proven by the integration parity + foreign-fixture tests.
function fakeContainer(
    rows: Array<{ id: string; k?: string; pk: unknown }>,
    capture?: (arg: { query: string; parameters: unknown[] }, opts: unknown) => void,
    requestCharge?: number,
): Container {
    return {
        items: {
            query(arg: { query: string; parameters: unknown[] }, opts: unknown) {
                capture?.(arg, opts);
                return { fetchAll: async () => ({ resources: rows, requestCharge }) };
            },
        },
    } as unknown as Container;
}

describe("buildCorpusIndex", () => {
    it("builds the tree from mapped keys and indexes point-read coords", async () => {
        let seen: { query: string; parameters: unknown[] } | undefined;
        let feedOpts: unknown;
        const container = fakeContainer(
            [
                { id: "id-a", k: "overview.md", pk: "cosmos-db-nosql" },
                { id: "id-b", k: "query/where.md", pk: "cosmos-db-nosql" },
            ],
            (arg, opts) => {
                seen = arg;
                feedOpts = opts;
            },
        );
        const mapping = buildMapping({ pkField: "namespace", namespaceValue: "cosmos-db-nosql" });
        const { tree, refs } = await buildCorpusIndex(container, mapping);

        expect(seen?.query).toBe(
            "SELECT c.id, c.key AS k, c.namespace AS pk FROM c WHERE c.namespace = @ns",
        );
        expect(feedOpts).toEqual({ partitionKey: "cosmos-db-nosql" });
        expect(tree.filePaths()).toEqual(["/overview.md", "/query/where.md"]);
        expect(refs.get("/query/where.md")).toEqual({ id: "id-b", pk: "cosmos-db-nosql" });
    });

    it("falls back to id as the key, and reads a foreign shape cross-partition", async () => {
        let seen: { query: string; parameters: unknown[] } | undefined;
        let feedOpts: unknown;
        const container = fakeContainer(
            [
                { id: "doc-1", k: "guide/oauth", pk: "doc-1" }, // mapped key present
                { id: "doc-2", k: undefined, pk: "doc-2" }, // unmapped -> key falls back to id
            ],
            (arg, opts) => {
                seen = arg;
                feedOpts = opts;
            },
        );
        const mapping = buildMapping({ keyField: "metadata.source", pkField: "id" });
        const { tree, refs } = await buildCorpusIndex(container, mapping);

        expect(seen?.query).toBe("SELECT c.id, c.metadata.source AS k, c.id AS pk FROM c");
        expect(feedOpts).toEqual({}); // no scope -> cross-partition, no pin
        expect(tree.filePaths()).toEqual(["/doc-2", "/guide/oauth"]);
        expect(refs.get("/guide/oauth")).toEqual({ id: "doc-1", pk: "doc-1" });
        expect(refs.get("/doc-2")).toEqual({ id: "doc-2", pk: "doc-2" });
    });

    it("records the tree-build query's request charge on the meter", async () => {
        const meter = new RuMeter();
        const container = fakeContainer(
            [{ id: "id-a", k: "overview.md", pk: "ns" }],
            undefined,
            3.14,
        );
        const mapping = buildMapping({ pkField: "namespace", namespaceValue: "ns" });
        await buildCorpusIndex(container, mapping, meter);
        expect(meter.total).toBeCloseTo(3.14, 5);
    });
});
