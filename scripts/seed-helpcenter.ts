// Seed the `helpcenter` example container used by the "explore an existing
// container" quickstart (docs/quickstarts/02-map-existing.md).
//
// This stands in for a container another team already populated with its OWN
// field names: the text is in `body`, the address in `docpath`, and the
// partition key is `/category`. cosmos-fs never writes this shape itself
// (`cosmos-fs ingest` writes the canonical content/key/namespace item), so the
// quickstart needs a small seed to give readers something real to explore.
//
// Data-plane only (full refresh: clears the container, then upserts), so it needs
// the Cosmos DB Built-in Data Contributor role — the same role the quickstarts
// already grant. The container itself is created out of band on the control plane:
//   COSMOS_ACCOUNT=<acct> COSMOS_RG=<rg> \
//     COSMOS_CONTAINER=helpcenter COSMOS_PK=/category COSMOS_THROUGHPUT=400 \
//     ./scripts/provision.sh
//
// Run: pnpm seed:helpcenter   (endpoint + database come from .env)

import type { Container } from "@azure/cosmos";
import { loadCorpusConfig } from "../src/config.js";
import { createContainer } from "../src/cosmos.js";

// Defaults to `helpcenter` (what the quickstart documents); an override lets the
// e2e suite seed an isolated container so it never races the shared one.
const CONTAINER = process.env.COSMOS_SEED_CONTAINER ?? "helpcenter";

// Foreign-shaped items: { id, category (PK), docpath, title, body }. "public"
// docs and "internal" runbooks share the container, partitioned by category.
const ITEMS = [
    {
        id: "hc-faq",
        category: "public",
        docpath: "faq.md",
        title: "FAQ",
        body: "# FAQ\n\n## How do I reset my password?\nOpen the account portal and choose \"Forgot password\"; a reset link is emailed to you.\n\n## What are the rate limits?\nFree plans allow 60 requests per minute. Paid plans raise the ceiling.",
    },
    {
        id: "hc-getting-started",
        category: "public",
        docpath: "guide/getting-started.md",
        title: "Getting started",
        body: "# Getting started\n\nCreate an account, generate an API key, and make your first call. Most teams are up and running in a few minutes.",
    },
    {
        id: "hc-webhooks",
        category: "public",
        docpath: "guide/webhooks.md",
        title: "Webhooks",
        body: "# Webhooks\nRegister a webhook URL. Each delivery is signed; verify the signature header. Failed deliveries retry with backoff.",
    },
    {
        id: "hc-limits",
        category: "public",
        docpath: "reference/limits.md",
        title: "Limits",
        body: "# Limits\n\nRequests are capped per minute by plan. Payloads may not exceed 5 MB. Exceeding a limit returns HTTP 429.",
    },
    {
        id: "hc-deploy",
        category: "internal",
        docpath: "runbooks/deploy.md",
        title: "Deploy runbook",
        body: "# Deploy runbook\n\nTag a release, run the migration, then roll out region by region. Watch error rates for ten minutes before continuing.",
    },
    {
        id: "hc-oncall",
        category: "internal",
        docpath: "runbooks/oncall.md",
        title: "On-call runbook",
        body: "# On-call runbook\n\nAlerts arrive over a webhook into the on-call channel. Acknowledge within five minutes, then follow the escalation path.",
    },
];

/**
 * Full refresh: delete every item currently in the example container so a re-run
 * (or a container polluted by earlier experiments) lands back at exactly the six
 * items below. Items written in the canonical shape have no `category`, so they
 * live in the "none" partition; delete those with the empty-object partition key.
 */
async function clearContainer(container: Container): Promise<number> {
    const { resources } = await container.items
        .query<{ id: string; category?: string }>("SELECT c.id, c.category FROM c")
        .fetchAll();
    for (const { id, category } of resources) {
        const partitionKey = category ?? ({} as Record<string, never>);
        await container.item(id, partitionKey).delete();
    }
    return resources.length;
}

async function main(): Promise<void> {
    const base = loadCorpusConfig();
    const container = createContainer({
        endpoint: base.endpoint,
        database: base.database,
        container: CONTAINER,
    });
    const cleared = await clearContainer(container);
    for (const item of ITEMS) {
        await container.items.upsert(item);
    }
    console.log(
        `Seeded ${ITEMS.length} items into ${base.database}/${CONTAINER} (cleared ${cleared} existing).`,
    );
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
