import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CliResult, cli, deleteContainer, E2E_ENABLED, ingest, PDFTOTEXT_AVAILABLE, provision } from "./harness.js";

// End-to-end replay of the "Ingest PDFs" guide (docs/guides/pdfs.md) through the
// real binary: extract text from the bundled sample PDFs with pdftotext, ingest
// the .txt output, and explore it like any other document set. Skips unless the
// account is configured (COSMOS_E2E) and pdftotext (Poppler) is installed.
const CONTAINER = "cosmosfs_e2e_pdfs";
const SAMPLE_PDFS = "examples/sample-pdfs";
let extractDir = "";

const run = (command: string): CliResult =>
    cli(["--namespace", "acme-pdfs", "-c", command], { COSMOS_CONTAINER: CONTAINER });

describe.skipIf(!E2E_ENABLED || !PDFTOTEXT_AVAILABLE)("e2e: ingest PDFs guide (pdftotext -> ingest -> explore)", () => {
    beforeAll(() => {
        extractDir = mkdtempSync(join(tmpdir(), "cosmosfs-e2e-pdfs-"));
        for (const pdf of readdirSync(SAMPLE_PDFS).filter((f) => f.endsWith(".pdf"))) {
            const out = join(extractDir, pdf.replace(/\.pdf$/, ".txt"));
            const res = spawnSync("pdftotext", ["-nopgbrk", join(SAMPLE_PDFS, pdf), out], { encoding: "utf8" });
            if ((res.status ?? 1) !== 0) {
                throw new Error(`pdftotext failed on ${pdf}: ${res.stderr}`);
            }
        }
        deleteContainer(CONTAINER);
        provision(CONTAINER);
        ingest(extractDir, "acme-pdfs", CONTAINER);
    }, 180_000);

    afterAll(() => {
        deleteContainer(CONTAINER);
        if (extractDir) {
            rmSync(extractDir, { recursive: true, force: true });
        }
    });

    it("PDFs: the extracted text lists like any document set", () => {
        expect(run("ls").stdout).toBe("pricing.txt\nsecurity.txt\n");
    });

    it("PDFs: grep finds a topic across the extracted text", () => {
        expect(run("grep -rl 'SOC 2' .").stdout).toBe("security.txt\n");
    });

    it("PDFs: grep -rn locates the line", () => {
        expect(run("grep -rn 429 .").stdout).toBe(
            "pricing.txt:4:Exceeding your quota returns HTTP 429. Upgrade the plan or contact sales for Enterprise pricing.\n",
        );
    });

    it("PDFs: cat reads the extracted page", () => {
        const out = run("cat security.txt").stdout;
        expect(out).toContain("Acme is SOC 2 Type II certified");
        expect(out).toContain("AES-256");
    });
});
