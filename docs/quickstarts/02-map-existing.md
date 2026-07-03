# Quickstart: explore an existing container

Your data is often already in Cosmos, written by another app that chose its own field
names. cosmos-fs browses it in place with `ls`/`cat`/`grep`, no re-ingest and no rewrites,
by **binding** its three roles to whichever fields hold your data.

To make this runnable, the repo ships a tiny seed that writes a container shaped like
another team's app: text in `body`, the file path in `docpath`, partition key `/category`.
If you already have such a container, skip step 1 and point the flags in step 3 at your own
fields instead.

**Prerequisite:** finish [Setup and prerequisites](setup.md) (Azure sign-in, `cosmos-fs`
on your PATH, `.env` with `COSMOS_ENDPOINT`). Seeding writes, so it uses the **Data
Contributor** role from Setup; exploring afterward is read-only.

## The idea: bind roles to your fields

cosmos-fs reads each item through three roles (`content`, `key`, `namespace`; see
[Concepts](../concepts.md)). A container written by another app uses its own field names,
so you **bind** the roles to those fields with flags. Nothing is rewritten.

The example container `helpcenter` holds items in that other app's shape:

```json
{
  "id": "hc-webhooks",
  "category": "public",
  "docpath": "guide/webhooks.md",
  "title": "Webhooks",
  "body": "# Webhooks\nRegister a webhook URL. Each delivery is signed; ..."
}
```

The text is in `body`, the path in `docpath`, and the partition key is `/category`.

## 1. Create the example container

`provision.sh` creates the container on the control plane (partitioned by `/category`),
then `pnpm seed:helpcenter` writes the six example items above. Point provisioning at your
account (the same values you used in [Setup](setup.md)):

```bash
COSMOS_ACCOUNT=<your-account-name> COSMOS_RG=<your-resource-group> \
  COSMOS_CONTAINER=helpcenter COSMOS_PK=/category COSMOS_THROUGHPUT=400 \
  ./scripts/provision.sh
pnpm seed:helpcenter
```

```
Account=<your-account-name>  RG=<your-resource-group>  DB=docs  Container=helpcenter  PK=/category  RU/s=400
created database 'docs'
created container 'helpcenter'
== container summary ==
{
  "id": "helpcenter",
  "partitionKey": { "kind": "Hash", "paths": [ "/category" ] },
  ...
}
Seeded 6 items into docs/helpcenter (cleared 0 existing).
```

Both are idempotent: re-running provisioning skips an existing container, and the seed
is a full refresh of the example container (it clears, then writes the six items), so it's
safe to run again. `cosmos-fs ingest` can't create this container because it always writes
the canonical `content`/`key`/`namespace` shape, and the point here is a *foreign* shape.

## 2. Point cosmos-fs at it

Set the container in `.env` (endpoint from [Setup](setup.md)):

```bash
COSMOS_ENDPOINT=https://<your-account>.documents.azure.com:443/
COSMOS_DATABASE=docs
COSMOS_CONTAINER=helpcenter
```

If you followed [Index your own docs](01-index-your-docs.md), **remove the
`COSMOS_FS_NAMESPACE` line** from `.env`: `helpcenter` is not scoped by a namespace field,
so a leftover value would filter on a field these items don't have and return nothing.

## 3. Bind the fields and explore

Tell cosmos-fs which field is the content and which is the key:

```bash
cosmos-fs --content-field body --key-field docpath -c "find . -type f | sort"
```

```
./faq.md
./guide/getting-started.md
./guide/webhooks.md
./reference/limits.md
./runbooks/deploy.md
./runbooks/oncall.md
```

The tree comes straight from the `docpath` values. `ls`, `cat`, and `grep` all work:

```bash
cosmos-fs --content-field body --key-field docpath -c "cat guide/webhooks.md"
```

```
# Webhooks
Register a webhook URL. Each delivery is signed; verify the signature header. Failed deliveries retry with backoff.
```

```bash
cosmos-fs --content-field body --key-field docpath -c "grep -rl webhook ."
```

```
guide/webhooks.md
runbooks/oncall.md
```

`cat` reads the `body` field of exactly one item (a point read), even though the key is
`docpath`, not the item id: cosmos-fs builds a `key -> id` index at startup so reads stay
cheap.

`grep -w` works here too, but it only gets the full-text speed-up when your content field is
the one with a full-text index. This example container has none on `body`, so `grep -w` scans
like a plain search (correct, just not accelerated). Add a full-text index on your text field
to make whole-word searches cheap at scale.

## 4. Scope to one partition (optional)

The sample spans two categories: `public` (the docs) and `internal` (the two runbooks).
To explore just one, bind the namespace role to the `category` field and pass the value:

```bash
cosmos-fs --content-field body --key-field docpath \
  --namespace-field category --namespace public \
  -c "find . -type f | sort"
```

```
./faq.md
./guide/getting-started.md
./guide/webhooks.md
./reference/limits.md
```

The `internal` runbooks are gone. Because the scope is the real partition key, this query
hits a single partition (cheaper). Scanning the whole container in step 3 is a
cross-partition query, which still works but costs more.

## 5. Stop repeating the flags

Put the bindings in `.env` so plain commands just work:

```bash
COSMOS_FS_CONTENT_FIELD=body
COSMOS_FS_KEY_FIELD=docpath
```

```bash
cosmos-fs -c "ls"
```

```
faq.md
guide
reference
runbooks
```

## Troubleshooting

- **`pnpm seed:helpcenter` fails with `403`.** Seeding writes, so it needs the **Data
  Contributor** role, not just Reader. See [Setup](setup.md#2-grant-yourself-data-plane-access).
- **Commands return nothing.** A leftover `COSMOS_FS_NAMESPACE` (for example from the
  [index-your-docs](01-index-your-docs.md) quickstart) is filtering on a field this
  container doesn't have. Remove it from `.env`, or override with `--namespace ''` to scan
  the whole container.
- **`Invalid field path '<x>'`.** Field names go into the query, so they must be
  identifier-safe (letters, digits, `_`), dotted for nesting (`metadata.source`).
- **`403` / RBAC hint on explore.** You lack a data-plane role on the account. See
  [Setup](setup.md#2-grant-yourself-data-plane-access).

## Next

- [Use cosmos-fs as an AI agent tool](03-agent-tool.md).
- `cosmos-fs --help` for the full mapping reference.
