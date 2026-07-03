# Bring your own data

cosmos-fs is read-only: it explores whatever is already in your Cosmos container. Two ways
to get data it can read: **write** items in the canonical shape below, or **map** the reader
onto an existing container's fields. New here? [Concepts](concepts.md) explains the item
roles (`content` / `key` / `namespace`) and how the tool works.

## The canonical schema

The bundled ingester writes each file as one item, naming the roles directly:

| Field | Meaning |
| --- | --- |
| `id` | Unique item id. Cannot contain `/ \ ? #` (or `%`, which makes point reads flaky), so use base64url of `key`. |
| `namespace` | Document-set name; the partition key. Selected with `--namespace` / `COSMOS_FS_NAMESPACE`. |
| `key` | The address, e.g. `query/array-length.md`. |
| `content` | The item text. |

`title` and `bytes` are optional extras. Because the partition key is `/namespace`, one
container can hold several independent document sets (one per `namespace`). The id encoding lives
in [../src/ids.ts](../src/ids.ts).

## Explore an existing container (field mapping, no re-ingest)

If your data already lives in Cosmos under different field names, point cosmos-fs at it and
bind the roles to your fields. Nothing is rewritten. For example, a LangChain-style store
keeps page text in `text`, the source path in `metadata.source`, and partitions by `/id`:

```bash
cosmos-fs --container my-vectors \
  --content-field text \
  --key-field metadata.source \
  -c "grep -rl oauth ."
```

- Field paths may be nested (`metadata.source`).
- Omit `--namespace` to scan the whole container (here the partition key is `/id`, so there
  is no separate scope). The container's partition key is detected automatically.
- `--namespace-field <field>` sets which field the `--namespace` value filters on (default
  `namespace`), for stores that scope by a custom field.

The reader always keeps a startup `key → id` index, so `cat` stays a ~1-RU point read even
when your `key` is not the `id`. Two cost notes (both still work, just cost more): if the
mapped `key` is neither the `id` nor the partition key, `cat` reads still resolve via the
index; if the scope is not the partition key (or is unset), `grep`/tree queries run
cross-partition instead of single-partition.

`grep -w` uses a full-text index only when your content field is the indexed path. A container
cosmos-fs did not provision usually has no full-text index on its text field, so `grep -w`
there scans like a plain grep (still correct, just not accelerated). Add a full-text index on
that field to keep whole-word searches cost effective.

## Provision a container

`scripts/provision.sh` creates the database and container: partition key `/namespace`, manual
throughput, and an indexing policy that keeps `/content` out of the range index while
full-text indexing it. The full-text index is what keeps `grep -w` cost effective; it is set at
container creation and cannot be added afterward, so recreate a container to gain it (this
needs Azure CLI 2.87 or newer). The script is idempotent and uses your `az login` session.
Override the targets with environment variables:

```bash
COSMOS_ACCOUNT=my-account COSMOS_RG=my-resource-group \
COSMOS_DATABASE=docs COSMOS_CONTAINER=pages COSMOS_PK=/namespace \
./scripts/provision.sh
```

You need Cosmos **data-plane** RBAC on the account. Control-plane roles like Owner are
not enough. Assign it with `az cosmosdb sql role assignment create`.

## Load your own data (`cosmos-fs ingest`)

The packaged writer uploads a local folder of text/markdown (one item per file) and
full-refreshes the namespace so each run is a clean mirror of the source:

```bash
cosmos-fs ingest ./my-notes --namespace my-notes
```

- Walks `.md` / `.mdx` / `.markdown` / `.txt`. `key` = the path relative to the folder;
  `title` = the first markdown `# H1` (else the key); `id` = base64url(`key`), automatically.
- `--namespace` (or `COSMOS_FS_NAMESPACE`) sets which document set to write into (it becomes the
  partition key). The container must already exist (see [Provision](#provision-a-container)).
- Other formats (PDF, HTML, …) stay at the edge: extract them to text with your own
  pipeline (e.g. LangChain loaders/splitters), then
  either write the resulting text files and run `cosmos-fs ingest`, or call the writer library
  ([../src/writer.ts](../src/writer.ts)) with plain `{ key, content, title? }` records. The
  writer handles the id/partition-key rules and the full refresh for you.

`pnpm ingest` is the same writer wired to `CORPUS_ROOT`, used to develop against the bundled
document set:

```bash
CORPUS_ROOT=/path/to/your/docs COSMOS_FS_NAMESPACE=my-docs pnpm ingest
```
