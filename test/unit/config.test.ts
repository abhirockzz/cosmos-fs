import { describe, expect, it } from "vitest";
import { loadCorpusConfig } from "../../src/config.js";

// loadCorpusConfig resolves flag > env > default. The one non-obvious rule: an
// empty/whitespace namespace means "no scope" (whole container), so `--namespace ''`
// can override a configured COSMOS_FS_NAMESPACE when pointing at a container that
// isn't scoped by a namespace field. Endpoint is passed explicitly so these stay
// hermetic regardless of the ambient environment.
describe("loadCorpusConfig namespace normalization", () => {
    it("keeps a non-empty namespace value", () => {
        expect(loadCorpusConfig({ endpoint: "https://x/", namespace: "ns" }).namespace).toBe("ns");
    });

    it("treats an empty or whitespace namespace as no scope (undefined)", () => {
        expect(loadCorpusConfig({ endpoint: "https://x/", namespace: "" }).namespace).toBeUndefined();
        expect(
            loadCorpusConfig({ endpoint: "https://x/", namespace: "   " }).namespace,
        ).toBeUndefined();
    });
});
