import { describe, expect, it } from "vitest";
import { loadCorpusConfig } from "../../src/config.js";
import { getContainer } from "../../src/cosmos.js";
import { keyToId } from "../../src/ids.js";

// Integration: hits the real Cosmos account. Run with `pnpm test:integration`.
describe("ingest read-back", () => {
    it("has pages for the namespace and a known page is point-readable", async () => {
        const cfg = loadCorpusConfig();
        const container = getContainer();
        const namespace = cfg.namespace;
        if (!namespace) {
            throw new Error("COSMOS_FS_NAMESPACE must be set for the integration test");
        }

        const { resources } = await container.items
            .query<number>({
                query: "SELECT VALUE COUNT(1) FROM c WHERE c.namespace = @namespace",
                parameters: [{ name: "@namespace", value: namespace }],
            })
            .fetchAll();
        expect(resources[0]).toBeGreaterThan(0);

        const knownKey = "overview.md";
        const { resource } = await container.item(keyToId(knownKey), namespace).read();
        expect(resource?.key).toBe(knownKey);
    }, 30_000);
});
