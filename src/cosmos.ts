import { type Container, CosmosClient } from "@azure/cosmos";
import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import { loadCorpusConfig } from "./config.js";

/** Address of a Cosmos container: which account endpoint, database, and container. */
export interface CosmosTarget {
    endpoint: string;
    database: string;
    container: string;
    /** Per-request network timeout (ms) and the budget the startup probe races. Default 10000. */
    connectTimeoutMs?: number;
}

/** Fallback per-request timeout (ms) when a target does not specify one. */
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

/**
 * The credential for the default (no-credential) path. cosmos-fs is a local
 * developer tool authenticated by `az login`, never hosted in Azure, so we pin
 * `DefaultAzureCredential` to its developer chain via `AZURE_TOKEN_CREDENTIALS`.
 * That skips the managed-identity/IMDS probe, which otherwise adds ~1s per
 * connect on a laptop with no metadata endpoint. Set the env var yourself to
 * override (it is only defaulted when unset).
 */
function defaultCredential(): TokenCredential {
    process.env.AZURE_TOKEN_CREDENTIALS ??= "dev";
    return new DefaultAzureCredential();
}

/**
 * Build a Cosmos container handle for a target. Auth goes through a
 * `TokenCredential` (AAD); the default picks up the `az login` session via the
 * developer credential chain (the account has local-auth/keys disabled). The
 * credential is a seam: callers may pass their own, and a future key /
 * connection-string path can supply a different strategy without changing callers.
 *
 * The connection policy caps a single request at `connectTimeoutMs` (default 10s,
 * down from the SDK's 60s) and trims the retry budget, so an unreachable or slow
 * account fails in seconds instead of stalling on stacked retries. The startup
 * connectivity probe in {@link openCorpus} races the same budget as a hard cap.
 */
export function createContainer(
    target: CosmosTarget,
    credential: TokenCredential = defaultCredential(),
): Container {
    const requestTimeout = target.connectTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const client = new CosmosClient({
        endpoint: target.endpoint,
        aadCredentials: credential,
        connectionPolicy: {
            requestTimeout,
            retryOptions: {
                maxRetryAttemptCount: 3,
                maxWaitTimeInSeconds: Math.max(5, Math.ceil(requestTimeout / 1000)),
            },
        },
    });
    return client.database(target.database).container(target.container);
}

let cached: Container | undefined;

/**
 * Process-wide singleton container from environment config, for the ingest/admin
 * scripts. The explore path builds its own container via {@link createContainer}
 * (see src/core.ts) so it can honor per-invocation config such as `--endpoint`.
 */
export function getContainer(): Container {
    if (!cached) {
        cached = createContainer(loadCorpusConfig());
    }
    return cached;
}
