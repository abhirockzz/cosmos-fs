import { describe, expect, it } from "vitest";
import {
    buildMapping,
    fieldToSql,
    getField,
    pkPathToField,
    scopeParts,
} from "../../src/mapping.js";

// mapping resolves cosmos-fs's item roles (content/key/namespace) onto whatever
// fields an existing container uses. Field names are interpolated into SQL (they
// cannot be query parameters), so the parse must reject anything that is not an
// identifier-safe dotted path — that is the injection guard.
describe("fieldToSql", () => {
    it("builds a property accessor for a plain field", () => {
        expect(fieldToSql("content")).toBe("c.content");
    });

    it("supports nested (dotted) field paths", () => {
        expect(fieldToSql("metadata.source")).toBe("c.metadata.source");
    });

    it("rejects paths that could carry SQL / injection", () => {
        for (const bad of [
            "content; DROP",
            "a b",
            "meta-data",
            "a.",
            "",
            "a..b",
            "'x'",
            "a)",
        ]) {
            expect(() => fieldToSql(bad)).toThrow(/Invalid field path/);
        }
    });
});

describe("getField", () => {
    const item = { content: "hi", metadata: { source: "guide/oauth" }, n: 3 };

    it("reads a top-level and a nested field", () => {
        expect(getField(item, "content")).toBe("hi");
        expect(getField(item, "metadata.source")).toBe("guide/oauth");
    });

    it("returns undefined for a missing path (no throw)", () => {
        expect(getField(item, "metadata.missing")).toBeUndefined();
        expect(getField(item, "nope")).toBeUndefined();
        expect(getField(item, "content.deep")).toBeUndefined(); // traversing into a string
        expect(getField(null, "content")).toBeUndefined();
    });
});

describe("pkPathToField", () => {
    it("strips the leading slash and dots nested paths", () => {
        expect(pkPathToField("/namespace")).toBe("namespace");
        expect(pkPathToField("/id")).toBe("id");
        expect(pkPathToField("/address/zip")).toBe("address.zip");
    });
});

describe("buildMapping", () => {
    it("applies canonical defaults and pins the partition when scope == PK", () => {
        const m = buildMapping({ pkField: "namespace", namespaceValue: "cosmos-db-nosql" });
        expect(m.contentExpr).toBe("c.content");
        expect(m.keyExpr).toBe("c.key");
        expect(m.pkExpr).toBe("c.namespace");
        expect(m.namespace).toEqual({ field: "namespace", value: "cosmos-db-nosql" });
        expect(m.pinPartition).toBe(true);
    });

    it("maps foreign fields and leaves scope unbound when no namespace value", () => {
        const m = buildMapping({
            contentField: "text",
            keyField: "metadata.source",
            pkField: "id",
        });
        expect(m.contentExpr).toBe("c.text");
        expect(m.keyExpr).toBe("c.metadata.source");
        expect(m.pkExpr).toBe("c.id");
        expect(m.namespace).toBeUndefined();
        expect(m.nsExpr).toBeUndefined();
        expect(m.pinPartition).toBe(false);
    });

    it("does not pin when the scope field is not the real PK (cross-partition)", () => {
        const m = buildMapping({
            namespaceField: "tenant",
            namespaceValue: "acme",
            pkField: "id",
        });
        expect(m.pinPartition).toBe(false);
    });

    it("throws on an unsafe field name at build time", () => {
        expect(() => buildMapping({ contentField: "a;b", pkField: "id" })).toThrow(
            /Invalid field path/,
        );
    });
});

describe("scopeParts", () => {
    it("returns an empty scope when no namespace is bound (whole container)", () => {
        const m = buildMapping({ keyField: "metadata.source", pkField: "id" });
        expect(scopeParts(m)).toEqual({ conditions: [], parameters: [] });
    });

    it("filters and pins when scope is the real PK", () => {
        const m = buildMapping({ pkField: "namespace", namespaceValue: "corpus-a" });
        expect(scopeParts(m)).toEqual({
            conditions: ["c.namespace = @ns"],
            parameters: [{ name: "@ns", value: "corpus-a" }],
            partitionKey: "corpus-a",
        });
    });

    it("filters without pinning when scope is not the PK", () => {
        const m = buildMapping({
            namespaceField: "tenant",
            namespaceValue: "acme",
            pkField: "id",
        });
        expect(scopeParts(m)).toEqual({
            conditions: ["c.tenant = @ns"],
            parameters: [{ name: "@ns", value: "acme" }],
        });
    });
});
