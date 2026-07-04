# Concepts: how cosmos-fs works

cosmos-fs turns an Azure Cosmos DB for NoSQL container into a read-only filesystem. Each
item is a file; you browse and search with `ls`, `cd`, `find`, `cat`, and `grep`, reading
whole documents.

## The three roles

cosmos-fs reads each item through three roles. Only the first is required; the others are
optional and fall back sensibly.

| Role | Required | What it is |
| --- | --- | --- |
| `content` | Yes | The text that `cat` returns and `grep` searches. |
| `key` | No | The item's address. Its `/`-separated value builds the browsable tree and is what `cat` opens. Unset: the item's `id` is used, so the tree is flat. |
| `namespace` | No | A scope, usually the container's partition key, so one container can hold several independent document sets. Unset: the whole container is in scope. |

Roles are not fixed field names. In the canonical schema the fields are literally
`content` / `key` / `namespace`, but you can bind the roles to whatever fields your data
already uses (see the two doors next).

## Two doors to get data cosmos-fs can read

- **Write** conforming items with `cosmos-fs ingest <folder>` or the writer library. This
  is the opinionated, optional path.
- **Map** the reader onto an existing container by binding the roles to its fields
  (`--content-field` / `--key-field` / `--namespace-field`). No re-ingest and no copy, so
  cosmos-fs reads data another tool wrote (for example a LangChain store).

## How it works

- **Tree:** one startup query reads every item's key and builds the directory tree in
  memory. `ls` / `cd` / `find` then run with no further Cosmos calls.
- **`cat`:** a single point read (~1 RU). A startup `key -> id` index keeps `cat` a point
  read even when the key is not the item id.
- **`grep`:** a plain literal pushes one `CONTAINS` query to Cosmos as a coarse filter, then
  the exact match runs in memory; other patterns fetch the content in one query. It is never
  one read per file.
- **`grep -w`:** whole-word search. `CONTAINS` is a partition scan whose cost grows with the
  document set; when the content field has a full-text index, `-w` uses it and fetches only
  the matching pages, so it stays cost effective at any size. Without the index it falls back to the
  scan. The in-memory match keeps the result identical to a plain `grep -w` either way. Reach
  for plain `grep` when you need a partial-word or regex match.
- **Everything else:** `info` reports the resolved connection and field mapping (no network),
  and the standard read-only text tools (`head`, `tail`, `sort`, `uniq`, `cut`, `tr`, `nl`,
  `sed`, `awk`, `jq`, `yq`, ...) all run in memory over piped output. Run `help` to list them
  and `<cmd> --help` for usage. None of them touch Cosmos: the only commands that ever query
  it are `cat`, `grep`, and the one-time startup build, so everything else adds 0 RU.
- **Read-only:** every write (`>`, `mkdir`, `rm`, ...) fails with `EROFS`, so cosmos-fs is
  safe to hand to an agent.

**Cost:** the defaults stay cost effective (single-partition access, point reads). If you map `key`
to a field that is not the id, `cat` still resolves through the index. If your scope is not
the partition key, or you scan the whole container, queries run cross-partition: they still
work, they just cost more.

## Next

- [Load your own data](ingest.md) for the canonical schema and provisioning.
- [Quickstarts](quickstarts/setup.md) for step-by-step guides.
- `cosmos-fs --help` for the full command and flag reference.
