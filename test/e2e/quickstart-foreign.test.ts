import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CliResult, cli, deleteContainer, E2E_ENABLED, provision, seedHelpcenter } from "./harness.js";

// End-to-end replay of Quickstart 2 "Explore an existing container"
// (docs/quickstarts/02-map-existing.md) through the REAL `cosmos-fs` binary: a
// foreign-shaped container (text in `body`, path in `docpath`, PK `/category`) is
// browsed by binding the roles with flags, no re-ingest. Provisions + seeds its
// own isolated container, asserts the documented output, then tears it down.
const CONTAINER = "cosmosfs_e2e_foreign";

// The docs tell readers to clear COSMOS_FS_NAMESPACE here (helpcenter has no
// namespace field); we replicate that so an unscoped query sees every item.
const map = (command: string, extra: string[] = []): CliResult =>
    cli(["--content-field", "body", "--key-field", "docpath", ...extra, "-c", command], {
        COSMOS_CONTAINER: CONTAINER,
        COSMOS_FS_NAMESPACE: "",
    });

describe.skipIf(!E2E_ENABLED)("e2e: explore an existing container / foreign field mapping", () => {
    beforeAll(() => {
        deleteContainer(CONTAINER);
        provision(CONTAINER, { COSMOS_PK: "/category", COSMOS_THROUGHPUT: "400" });
        seedHelpcenter(CONTAINER);
    }, 180_000);

    afterAll(() => {
        deleteContainer(CONTAINER);
    });

    it("QS2: `find` lists all six files from the docpath keys", () => {
        expect(map("find . -type f | sort").stdout).toBe(
            "./faq.md\n./guide/getting-started.md\n./guide/webhooks.md\n./reference/limits.md\n./runbooks/deploy.md\n./runbooks/oncall.md\n",
        );
    });

    it("QS2: `grep` searches the bound body field", () => {
        expect(map("grep -rl webhook .").stdout).toBe("guide/webhooks.md\nrunbooks/oncall.md\n");
    });

    it("QS2: `cat` point-reads one item's body", () => {
        expect(map("cat guide/webhooks.md").stdout).toBe(
            "# Webhooks\nRegister a webhook URL. Each delivery is signed; verify the signature header. Failed deliveries retry with backoff.",
        );
    });

    it("QS2: scoping to one partition (category=public) hides the internal runbooks", () => {
        expect(map("find . -type f | sort", ["--namespace-field", "category", "--namespace", "public"]).stdout).toBe(
            "./faq.md\n./guide/getting-started.md\n./guide/webhooks.md\n./reference/limits.md\n",
        );
    });
});
