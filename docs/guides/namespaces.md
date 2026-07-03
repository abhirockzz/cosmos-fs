# Guide: separate document sets with namespaces

One Cosmos container can hold several independent sets of documents at once: each product's
docs, each release version, or each team's notes. cosmos-fs tags each set with a
**namespace**, and you pick which set you are working in. The sets never mix, and there is
nothing extra to provision. This guide loads two sets side by side and switches between them.

**Prerequisite:** you can already ingest and explore a folder (see
[Index your own docs](../quickstarts/01-index-your-docs.md)). A **namespace** is the
partition-key value that names one document set; see [Concepts](../concepts.md).

## Load two document sets

A namespace is chosen at ingest time with `--namespace`. Ingest two different folders into
two namespaces of the same container:

```bash
cosmos-fs ingest examples/sample-docs  --namespace nimbus-docs
cosmos-fs ingest examples/acme-widgets --namespace acme-docs
```

```
Ingested 6 items into docs/pages (namespace=nimbus-docs; cleared 6 existing).
Ingested 3 items into docs/pages (namespace=acme-docs; cleared 0 existing).
```

Each namespace is a separate set of documents in the same container. Ingesting one never
touches the other (note the second ingest cleared 0, not 6).

## Explore each set

Pick the set with `--namespace`:

```bash
cosmos-fs --namespace nimbus-docs -c "ls"
```

```
faq.md
getting-started.md
guide
reference
```

```bash
cosmos-fs --namespace acme-docs -c "ls"
```

```
faq.md
guide
overview.md
```

## The sets stay isolated

A search only sees the namespace you select. The same term returns different files in each:

```bash
cosmos-fs --namespace nimbus-docs -c "grep -rl 429 ."
```

```
faq.md
reference/cli.md
reference/errors.md
```

```bash
cosmos-fs --namespace acme-docs -c "grep -rl 429 ."
```

```
faq.md
guide/quotas.md
```

Because a namespace is the partition key, each of these is a single-partition query: fast
and cost effective, with no chance of one set leaking into another's results.

## Switch the default

To avoid repeating `--namespace`, set the default in the environment (or `.env`):

```bash
export COSMOS_FS_NAMESPACE=acme-docs
cosmos-fs -c "cat guide/quotas.md | head -5"
```

```
# Quotas

Acme Widgets enforces per-plan quotas. Exceeding a quota returns `429 Too Many Requests`;
back off and retry, or upgrade the plan.
```

The `--namespace` flag always overrides the environment, so you can keep a default and dip
into another set for one command.

## One container, or separate containers?

Namespaces in one container are the simple default: cost effective, isolated, and nothing extra to
provision. Reach for separate containers only when a document set needs its own throughput,
indexing policy, or access control.

## Next

- [Ingest PDFs](pdfs.md) to bring non-markdown content in.
- `cosmos-fs --help` for the full flag reference.
