import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CliResult, cli, deleteContainer, E2E_ENABLED, ingest, provision, sleep } from "./harness.js";

// End-to-end replay of the documented user journeys through the REAL `cosmos-fs`
// binary: Quickstart 1 "Index your own docs" (docs/quickstarts/01-index-your-docs.md)
// and the "Separate document sets with namespaces" guide (docs/guides/namespaces.md).
// It provisions its own FTS container, ingests the in-repo fixtures, asserts the
// exact output the docs promise, then tears the container down. Opt-in (see harness).
const CONTAINER = "cosmosfs_e2e_explore";
const nimbus = "faq.md\ngetting-started.md\nguide/configuration.md\nreference/cli.md\nreference/errors.md\n";

const run = (namespace: string, command: string): CliResult =>
    cli(["--namespace", namespace, "-c", command], { COSMOS_CONTAINER: CONTAINER });

describe.skipIf(!E2E_ENABLED)("e2e: index-your-docs + namespaces (real cosmos-fs binary)", () => {
    beforeAll(async () => {
        deleteContainer(CONTAINER); // clean slate; no-op if absent
        provision(CONTAINER); // default PK /namespace + full-text index (provision.sh)
        ingest("examples/sample-docs", "nimbus-docs", CONTAINER);
        ingest("examples/acme-widgets", "acme-docs", CONTAINER);
        // The full-text index builds asynchronously; wait until `grep -w` sees every match.
        for (let i = 0; i < 20; i++) {
            if (run("nimbus-docs", "grep -rwl region .").stdout === nimbus) {
                break;
            }
            await sleep(3000);
        }
    }, 240_000);

    afterAll(() => {
        deleteContainer(CONTAINER);
    });

    // ---- Quickstart 1: index your own docs ----
    it("QS1: `ls` lists the tree", () => {
        const r = run("nimbus-docs", "ls");
        expect(r.code).toBe(0);
        expect(r.stdout).toBe("faq.md\ngetting-started.md\nguide\nreference\n");
    });

    it("QS1: `find . -type f` walks all six files", () => {
        expect(run("nimbus-docs", "find . -type f | sort").stdout).toBe(
            "./faq.md\n./getting-started.md\n./guide/authentication.md\n./guide/configuration.md\n./reference/cli.md\n./reference/errors.md\n",
        );
    });

    it("QS1: `grep -rl 429` lists matching files", () => {
        expect(run("nimbus-docs", "grep -rl 429 .").stdout).toBe(
            "faq.md\nreference/cli.md\nreference/errors.md\n",
        );
    });

    it("QS1: `grep -rn 'rate limit'` shows numbered lines", () => {
        expect(run("nimbus-docs", "grep -rn 'rate limit' .").stdout).toBe(
            "faq.md:6:buckets, more storage, and a higher rate limit.\n" +
                "faq.md:15:You are sending requests faster than your plan's rate limit allows. The CLI\n" +
                "reference/errors.md:23:You exceeded the rate limit. Back off and retry; the CLI does this for you with\n",
        );
    });

    it("QS1: `grep -rwl region` uses the full-text index (whole-word)", () => {
        const r = run("nimbus-docs", "grep -rwl region .");
        expect(r.code).toBe(0);
        expect(r.stdout).toBe(nimbus);
    });

    it("QS1: writes fail with EROFS", () => {
        const r = run("nimbus-docs", "rm getting-started.md");
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain("EROFS");
    });

    // ---- Guide: separate document sets with namespaces ----
    it("namespaces: each set lists only its own files", () => {
        expect(run("acme-docs", "ls").stdout).toBe("faq.md\nguide\noverview.md\n");
    });

    it("namespaces: the same term returns different files per namespace", () => {
        expect(run("nimbus-docs", "grep -rl 429 .").stdout).toBe(
            "faq.md\nreference/cli.md\nreference/errors.md\n",
        );
        expect(run("acme-docs", "grep -rl 429 .").stdout).toBe("faq.md\nguide/quotas.md\n");
    });
});
