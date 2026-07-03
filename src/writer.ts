import type { Container } from "@azure/cosmos";
import { keyToId } from "./ids.js";

/**
 * A plain, source- and format-agnostic input record. The writer turns it into a
 * canonical cosmos-fs item; callers only supply the address (`key`), the text
 * (`content`), and an optional `title`.
 */
export interface CorpusRecord {
    key: string;
    content: string;
    title?: string;
}

/** Counts from an ingest run: items removed by the full refresh, and items written. */
export interface IngestResult {
    cleared: number;
    upserted: number;
}

/**
 * Delete every existing item in a namespace so ingest is a clean full refresh
 * rather than an accretive upsert: the container mirrors the source (stale items
 * drop out) and re-ingest stays idempotent even if the id scheme changes (ids are
 * the key). Single-partition (PK = namespace), ~1 RU per delete.
 */
async function clearNamespace(container: Container, namespace: string): Promise<number> {
    const { resources: ids } = await container.items
        .query<string>(
            {
                query: "SELECT VALUE c.id FROM c WHERE c.namespace = @namespace",
                parameters: [{ name: "@namespace", value: namespace }],
            },
            { partitionKey: namespace },
        )
        .fetchAll();
    for (const id of ids) {
        await container.item(id, namespace).delete();
    }
    return ids.length;
}

/**
 * Write records into a namespace as canonical cosmos-fs items: `id =
 * base64url(key)` (URL-safe, `%`-free — see src/ids.ts), the `namespace`
 * partition key, plus `content`, `title` (defaults to the key), and `bytes`.
 * Clears the namespace first (full refresh). Source- and format-agnostic: any
 * caller (the folder CLI, a user's own pipeline) that produces `{ key, content,
 * title? }` records gets a Cosmos-correct upload without repeating the id/PK
 * rules. The explore engine (read-time) is where genericness lives; this writer
 * is the opinionated, optional door.
 */
export async function ingestRecords(
    container: Container,
    namespace: string,
    records: Iterable<CorpusRecord>,
    onProgress?: (upserted: number) => void,
): Promise<IngestResult> {
    const cleared = await clearNamespace(container, namespace);
    let upserted = 0;
    for (const record of records) {
        await container.items.upsert({
            id: keyToId(record.key),
            namespace,
            key: record.key,
            content: record.content,
            title: record.title ?? record.key,
            bytes: Buffer.byteLength(record.content, "utf8"),
        });
        upserted++;
        onProgress?.(upserted);
    }
    return { cleared, upserted };
}
