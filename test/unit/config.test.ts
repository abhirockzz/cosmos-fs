import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCorpusConfig } from "../../src/config.js";

// loadCorpusConfig resolves flag > env > default. The one non-obvious rule: an
// empty/whitespace namespace means "no scope" (whole container), so `--namespace ''`
// can override a configured COSMOS_FS_NAMESPACE when pointing at a container that
// isn't scoped by a namespace field. Endpoint is passed explicitly so these stay
// hermetic regardless of the ambient environment.
describe("loadCorpusConfig namespace normalization", () => {
    it("keeps a non-empty namespace value", () => {
        expect(
            loadCorpusConfig({ endpoint: "https://x/", database: "d", container: "c", namespace: "ns" }).namespace,
        ).toBe("ns");
    });

    it("treats an empty or whitespace namespace as no scope (undefined)", () => {
        expect(
            loadCorpusConfig({ endpoint: "https://x/", database: "d", container: "c", namespace: "" }).namespace,
        ).toBeUndefined();
        expect(
            loadCorpusConfig({ endpoint: "https://x/", database: "d", container: "c", namespace: "   " }).namespace,
        ).toBeUndefined();
    });
});

// Database and container are required with no default name: a silent fallback
// would point at a container the user never chose. These lock that contract
// (and guard against a default being reintroduced). vi.stubEnv keeps them
// independent of any real .env in the working directory; a blank value counts
// as unset.
describe("loadCorpusConfig required target (database, container)", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("resolves database and container from flags", () => {
        const cfg = loadCorpusConfig({ endpoint: "https://x/", database: "mydb", container: "mycon" });
        expect(cfg.database).toBe("mydb");
        expect(cfg.container).toBe("mycon");
    });

    it("resolves database and container from the environment", () => {
        vi.stubEnv("COSMOS_DATABASE", "envdb");
        vi.stubEnv("COSMOS_CONTAINER", "envcon");
        const cfg = loadCorpusConfig({ endpoint: "https://x/" });
        expect(cfg.database).toBe("envdb");
        expect(cfg.container).toBe("envcon");
    });

    it("throws when the database is missing", () => {
        vi.stubEnv("COSMOS_DATABASE", "");
        vi.stubEnv("COSMOS_CONTAINER", "c");
        expect(() => loadCorpusConfig({ endpoint: "https://x/" })).toThrow(/Missing Cosmos database/);
    });

    it("throws when the container is missing (blank counts as unset)", () => {
        vi.stubEnv("COSMOS_DATABASE", "d");
        vi.stubEnv("COSMOS_CONTAINER", "   ");
        expect(() => loadCorpusConfig({ endpoint: "https://x/" })).toThrow(/Missing Cosmos container/);
    });
});
