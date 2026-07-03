import { describe, expect, it } from "vitest";
import type { Container } from "@azure/cosmos";
import { CosmosFs } from "../../src/cosmos-fs.js";
import { buildMapping } from "../../src/mapping.js";
import { DirTree } from "../../src/tree.js";

// Direct coverage for the high-risk adapter. The parity oracle (integration)
// exercises ls/cd/find and real cat content, but it structurally cannot cover
// writes (the oracle fs would succeed) or the offline guards on content reads,
// so those contracts are asserted here. This container fails loudly if touched,
// proving the directory/missing checks short-circuit before any Cosmos call.
function unreachableContainer(): Container {
    return {
        item() {
            throw new Error("unexpected Cosmos point read in an offline unit test");
        },
    } as unknown as Container;
}

function makeFs(): CosmosFs {
    return new CosmosFs(
        new DirTree(["overview.md", "query/functions/array-length.md", "query/keywords/where.md"]),
        unreachableContainer(),
        buildMapping({ pkField: "namespace", namespaceValue: "test-namespace" }),
        new Map(),
    );
}

describe("CosmosFs structural ops", () => {
    it("stat reports directories and files", async () => {
        const fs = makeFs();
        expect((await fs.stat("/")).isDirectory).toBe(true);
        expect((await fs.stat("/query")).isDirectory).toBe(true);
        const file = await fs.stat("/overview.md");
        expect(file.isFile).toBe(true);
        expect(file.isDirectory).toBe(false);
    });

    it("stat throws ENOENT for unknown paths", async () => {
        await expect(makeFs().stat("/nope")).rejects.toThrow(/ENOENT.*stat '\/nope'/);
    });

    it("exists covers files and dirs but not unknown paths", async () => {
        const fs = makeFs();
        expect(await fs.exists("/query")).toBe(true);
        expect(await fs.exists("/overview.md")).toBe(true);
        expect(await fs.exists("/missing")).toBe(false);
    });

    it("readdir lists sorted children and errors correctly", async () => {
        const fs = makeFs();
        expect(await fs.readdir("/")).toEqual(["overview.md", "query"]);
        expect(await fs.readdir("/query")).toEqual(["functions", "keywords"]);
        await expect(fs.readdir("/overview.md")).rejects.toThrow(/ENOTDIR/);
        await expect(fs.readdir("/nope")).rejects.toThrow(/ENOENT/);
    });

    it("readdirWithFileTypes marks entry types", async () => {
        expect(await makeFs().readdirWithFileTypes("/query")).toEqual([
            { name: "functions", isFile: false, isDirectory: true, isSymbolicLink: false },
            { name: "keywords", isFile: false, isDirectory: true, isSymbolicLink: false },
        ]);
    });

    it("resolvePath normalizes and clamps .. at root", () => {
        const fs = makeFs();
        expect(fs.resolvePath("/query", "functions/array-length.md")).toBe(
            "/query/functions/array-length.md",
        );
        expect(fs.resolvePath("/query/functions", "../keywords/where.md")).toBe(
            "/query/keywords/where.md",
        );
        expect(fs.resolvePath("/", "../../etc/passwd")).toBe("/etc/passwd");
        expect(fs.resolvePath("", "query")).toBe("/query");
    });

    it("getAllPaths returns the full sorted tree", () => {
        expect(makeFs().getAllPaths()).toEqual([
            "/",
            "/overview.md",
            "/query",
            "/query/functions",
            "/query/functions/array-length.md",
            "/query/keywords",
            "/query/keywords/where.md",
        ]);
    });

    it("realpath returns known paths, else ENOENT", async () => {
        const fs = makeFs();
        expect(await fs.realpath("/query/functions")).toBe("/query/functions");
        await expect(fs.realpath("/nope")).rejects.toThrow(/ENOENT.*realpath/);
    });

    it("readlink rejects (the corpus has no symlinks)", async () => {
        const fs = makeFs();
        await expect(fs.readlink("/overview.md")).rejects.toThrow(/EINVAL/);
        await expect(fs.readlink("/nope")).rejects.toThrow(/ENOENT/);
    });
});

describe("CosmosFs content reads guard before touching Cosmos", () => {
    it("cat on a directory throws EISDIR (no point read)", async () => {
        const fs = makeFs();
        await expect(fs.readFile("/query")).rejects.toThrow(/EISDIR.*read '\/query'/);
        await expect(fs.readFileBuffer("/query")).rejects.toThrow(/EISDIR/);
    });

    it("cat on a missing path throws ENOENT (no point read)", async () => {
        const fs = makeFs();
        await expect(fs.readFile("/nope.md")).rejects.toThrow(/ENOENT.*open '\/nope.md'/);
        await expect(fs.readFileBuffer("/nope.md")).rejects.toThrow(/ENOENT/);
    });
});

describe("CosmosFs is read-only", () => {
    it("every mutating operation throws EROFS", async () => {
        const fs = makeFs();
        await expect(fs.writeFile("/x.md", "x")).rejects.toThrow(/EROFS/);
        await expect(fs.appendFile("/x.md", "x")).rejects.toThrow(/EROFS/);
        await expect(fs.mkdir("/d")).rejects.toThrow(/EROFS/);
        await expect(fs.rm("/overview.md")).rejects.toThrow(/EROFS/);
        await expect(fs.cp("/overview.md", "/y.md")).rejects.toThrow(/EROFS/);
        await expect(fs.mv("/overview.md", "/y.md")).rejects.toThrow(/EROFS/);
        await expect(fs.chmod("/overview.md")).rejects.toThrow(/EROFS/);
        await expect(fs.symlink("/overview.md", "/l")).rejects.toThrow(/EROFS/);
        await expect(fs.link("/overview.md", "/l")).rejects.toThrow(/EROFS/);
        await expect(fs.utimes("/overview.md")).rejects.toThrow(/EROFS/);
    });
});
