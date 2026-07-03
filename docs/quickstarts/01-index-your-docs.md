# Quickstart: index your own docs

cosmos-fs makes a folder of documents searchable from Cosmos DB: it uploads each file as
an item, then lets you explore them with familiar shell commands (`ls`, `find`, `cat`,
`grep`). This quickstart loads a sample folder, then browses and searches it.

**Prerequisite:** finish [Setup and prerequisites](setup.md) first (Azure sign-in,
data-plane role, `cosmos-fs` on your PATH, `.env` with `COSMOS_ENDPOINT`).

This quickstart uses the bundled sample documents at `examples/sample-docs/` (a small
fictional product's docs). Swap in your own folder at the end.

## 1. Create a container

cosmos-fs stores one item per file in a Cosmos container partitioned by `/namespace`.
`scripts/provision.sh` creates it for you (idempotent, safe to re-run). Point it at
your account:

```bash
COSMOS_ACCOUNT=<your-account-name> COSMOS_RG=<your-resource-group> ./scripts/provision.sh
```

```
Account=<your-account-name>  RG=<your-resource-group>  DB=docs  Container=pages  PK=/namespace  RU/s=1000
created database 'docs'
created container 'pages' (full-text index on /content)
== container summary ==
{
  "id": "pages",
  "partitionKey": { "kind": "Hash", "paths": [ "/namespace" ] },
  ...
}
```

It creates database `docs` and container `pages` (override with `COSMOS_DATABASE` /
`COSMOS_CONTAINER`). If they already exist, it says so and moves on.

## 2. Name your document set

A **namespace** is one document set inside the container (the partition key value). Set it in
`.env` so you don't repeat it on every command:

```bash
echo "COSMOS_FS_NAMESPACE=nimbus-docs" >> .env
```

## 3. Ingest the folder

```bash
cosmos-fs ingest examples/sample-docs
```

```
Ingested 6 items into docs/pages (namespace=nimbus-docs; cleared 0 existing).
```

Each file becomes one item: the path relative to the folder is its `key`, the file text
is its `content`, and the id is `base64url(key)`. Ingest is a **full refresh** of the
namespace, so re-running mirrors the folder exactly (stale items drop out).

## 4. Explore

List the tree and walk it like a filesystem:

```bash
cosmos-fs -c "ls"
```

```
faq.md
getting-started.md
guide
reference
```

```bash
cosmos-fs -c "find . -type f | sort"
```

```
./faq.md
./getting-started.md
./guide/authentication.md
./guide/configuration.md
./reference/cli.md
./reference/errors.md
```

Read a page. `cat` is a single point read (~1 RU):

```bash
cosmos-fs -c "cat getting-started.md | head -6"
```

```
# Getting started with Nimbus

Nimbus is a small object-storage API. You upload files to a bucket and read them
back over HTTPS. This page gets you from zero to your first upload.

## Install the CLI
```

Search content across the document set. `grep -rl` lists the files that match:

```bash
cosmos-fs -c "grep -rl 429 ."
```

```
faq.md
reference/cli.md
reference/errors.md
```

`grep -rn` shows matching lines with numbers:

```bash
cosmos-fs -c "grep -rn 'rate limit' ."
```

```
faq.md:6:buckets, more storage, and a higher rate limit.
faq.md:15:You are sending requests faster than your plan's rate limit allows. The CLI
reference/errors.md:23:You exceeded the rate limit. Back off and retry; the CLI does this for you with
```

Pipes work, so you can search, then read just the relevant slice:

```bash
cosmos-fs -c "cat reference/errors.md | grep -A2 '## 429'"
```

```
## 429 Too Many Requests

You exceeded the rate limit. Back off and retry; the CLI does this for you with
```

`grep -w` searches for whole words and uses the container's full-text index, so it stays
fast as the document set grows:

```bash
cosmos-fs -c "grep -rwl region ."
```

```
faq.md
getting-started.md
guide/configuration.md
reference/cli.md
reference/errors.md
```

It matches whole words, not substrings, so it is narrower than a plain search: `grep -rl
config .` also finds `configuration`, while `grep -rwl config .` matches only the standalone
word. Use plain `grep` for partial-word or regex searches, which read every page.

## 5. It's read-only

Every write fails, so the documents are safe to hand to an automated tool or agent:

```bash
cosmos-fs -c "rm getting-started.md"
```

```
rm: cannot remove 'getting-started.md': EROFS: read-only file system, unlink '/getting-started.md'
```

The command exits non-zero, and nothing changed.

## Now use your own folder

Point `ingest` at any folder of `.md` / `.mdx` / `.markdown` / `.txt` files:

```bash
echo "COSMOS_FS_NAMESPACE=my-notes" >> .env    # or edit the existing line
cosmos-fs ingest ~/path/to/your/docs
cosmos-fs -c "ls"
```

Each namespace is independent, so one container can hold many document sets. Switch between
them with `COSMOS_FS_NAMESPACE` or the `--namespace` flag.

## Troubleshooting

- **`ls` prints nothing.** `COSMOS_FS_NAMESPACE` doesn't match what you ingested. Check
  the value in `.env` against the namespace shown in the ingest output.
- **`no .md/.mdx/.markdown/.txt files found under '<folder>'`.** Wrong path, or the folder
  has no text files. cosmos-fs indexes text/markdown only; convert other formats first
  (see [Explore an existing container](02-map-existing.md) for the PDF note).
- **`403` / RBAC hint on ingest.** Ingest writes, so it needs the **Data Contributor**
  role, not just Reader. See [Setup](setup.md#2-grant-yourself-data-plane-access).

## Next

- [Explore an existing container](02-map-existing.md) if your data is already in Cosmos.
- [Use cosmos-fs as an AI agent tool](03-agent-tool.md).
- `cosmos-fs --help` for the full command and flag reference.
