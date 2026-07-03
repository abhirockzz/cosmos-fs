import { loadIngestConfig } from "./config.js";
import { collectMarkdownPaths, readRecords } from "./corpus.js";
import { getContainer } from "./cosmos.js";
import { ingestRecords } from "./writer.js";

/**
 * Admin script (`pnpm ingest`) for the canonical corpus: walk CORPUS_ROOT for
 * markdown, then hand the records to the shared writer, which owns the
 * Cosmos-correct upload (id/PK/full-refresh). This script only knows the source
 * (a local markdown folder). `cosmos-fs ingest <folder>` is the packaged CLI
 * equivalent over the same writer.
 */
async function main(): Promise<void> {
    const cfg = loadIngestConfig();
    if (!cfg.corpusRoot) {
        throw new Error("Missing CORPUS_ROOT (copy .env.example to .env)");
    }
    if (!cfg.namespace) {
        throw new Error("Missing namespace: set COSMOS_FS_NAMESPACE (the corpus to write into)");
    }
    const namespace = cfg.namespace;
    const paths = await collectMarkdownPaths(cfg.corpusRoot);
    console.log(`Found ${paths.length} markdown files under ${cfg.corpusRoot}`);

    const records = await readRecords(cfg.corpusRoot, paths);
    const { cleared, upserted } = await ingestRecords(getContainer(), namespace, records, (n) => {
        if (n % 25 === 0) {
            console.log(`  upserted ${n}/${records.length}`);
        }
    });

    console.log(`Cleared ${cleared} existing items for namespace=${namespace} (full refresh)`);
    console.log(
        `Done. Upserted ${upserted} items into ${cfg.database}/${cfg.container} (namespace=${namespace}).`,
    );
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
