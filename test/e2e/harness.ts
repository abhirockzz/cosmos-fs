import { spawnSync } from "node:child_process";

const ACCOUNT = process.env.COSMOS_ACCOUNT ?? "";
const RG = process.env.COSMOS_RG ?? "";
const DB = process.env.COSMOS_DATABASE ?? "docs";

// e2e runs the real packaged binary against a live account, so it is opt-in:
// COSMOS_E2E=1 plus COSMOS_ACCOUNT / COSMOS_RG (for provisioning). Endpoint and
// database come from .env like any other run. Without these, the suites skip.
export const E2E_ENABLED = process.env.COSMOS_E2E === "1" && ACCOUNT !== "" && RG !== "";

// The PDF guide needs Poppler's `pdftotext`; its e2e skips where that is absent.
export const PDFTOTEXT_AVAILABLE = spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).error === undefined;

export interface CliResult {
    stdout: string;
    stderr: string;
    code: number;
}

/** Run the built CLI exactly as a user/agent would: `node dist/cli.js <args>`. */
export function cli(args: string[], env: NodeJS.ProcessEnv = {}): CliResult {
    const res = spawnSync("node", ["dist/cli.js", ...args], {
        encoding: "utf8",
        // database is required now, so pass it explicitly (defaults to `docs`)
        // rather than relying on the spawned CLI picking it up from .env.
        env: { ...process.env, COSMOS_DATABASE: DB, ...env },
    });
    return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", code: res.status ?? 1 };
}

/** Create a container via the documented provision.sh (control plane). */
export function provision(container: string, extra: NodeJS.ProcessEnv = {}): void {
    const res = spawnSync("bash", ["scripts/provision.sh"], {
        encoding: "utf8",
        env: { ...process.env, COSMOS_ACCOUNT: ACCOUNT, COSMOS_RG: RG, COSMOS_CONTAINER: container, ...extra },
    });
    if ((res.status ?? 1) !== 0) {
        throw new Error(`provision '${container}' failed: ${res.stderr || res.stdout}`);
    }
}

/** Ingest a local folder into a namespace of a container (the documented `cosmos-fs ingest`). */
export function ingest(folder: string, namespace: string, container: string): void {
    const res = cli(["ingest", folder, "--namespace", namespace], { COSMOS_CONTAINER: container });
    if (res.code !== 0) {
        throw new Error(`ingest '${folder}' failed: ${res.stderr}`);
    }
}

/** Seed the foreign-shaped helpcenter fixture into an isolated container. */
export function seedHelpcenter(container: string): void {
    const res = spawnSync("pnpm", ["seed:helpcenter"], {
        encoding: "utf8",
        env: { ...process.env, COSMOS_SEED_CONTAINER: container },
    });
    if ((res.status ?? 1) !== 0) {
        throw new Error(`seed helpcenter '${container}' failed: ${res.stderr || res.stdout}`);
    }
}

/** Delete a container (teardown); ignores "not found" so it is safe to pre-clean. */
export function deleteContainer(container: string): void {
    spawnSync(
        "az",
        ["cosmosdb", "sql", "container", "delete", "-a", ACCOUNT, "-g", RG, "-d", DB, "-n", container, "-y", "--only-show-errors", "-o", "none"],
        { encoding: "utf8" },
    );
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
