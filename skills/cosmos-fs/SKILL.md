---
name: cosmos-fs
description: Explore and search a document set stored in Azure Cosmos DB through the read-only cosmos-fs CLI, using shell commands (ls, cd, find, cat, grep). Use when answering questions from a document set indexed with cosmos-fs, browsing ingested docs, code, or notes, or when the user mentions cosmos-fs, a Cosmos DB document set, or a docs container to search.
---

# cosmos-fs: explore documents like a filesystem

`cosmos-fs` is a read-only shell over documents in Azure Cosmos DB. Each item is a file; browse
and search with `ls`, `cd`, `find`, `cat`, and `grep`.

**Answer only from what the source file says, and cite it. Reproduce its exact wording, values,
and code; do not add names, numbers, syntax, or steps it does not contain, however plausible.**

## Quick start

Launch with your connection, search for a likely term, read the top hit, then answer and cite it:

```text
$ cosmos-fs --endpoint <url> --database <db> --container <c> --namespace <ns>
/ $ grep -rwil "array length" .
query/array-length.md
/ $ cat query/array-length.md | grep -A2 '## Syntax'
ARRAY_LENGTH(<array_expr>)
```

→ Answer `ARRAY_LENGTH(<array_expr>)`, citing `query/array-length.md`.

When several pages match, pick the most specific one:

```text
/ $ grep -rwil "vector search" .
hybrid-search.md
query/vectordistance.md
...
/ $ cat query/vectordistance.md | grep -A2 '## Syntax'
VECTORDISTANCE(<vector_expr_1>, <vector_expr_2>, <bool_expr>, <obj_expr>)
```

→ Answer `VECTORDISTANCE(...)`, citing `query/vectordistance.md`.

## Running it

`cosmos-fs` is a global command on your `PATH`. Run it directly by name; do not `cd`, use
`./cosmos-fs`, or `which`/`find` it. It needs `az login` and its target passed as flags:

```text
cosmos-fs --endpoint <url> --database <db> --container <c> --namespace <ns> [-c "<command>"]
```

Each launch pays a fixed startup cost, so **minimize launches** (cost tracks launches, not
commands):

- **Persistent shell available:** launch once, then send bare commands one at a time.
- **Stateless `bash` tool (common):** batch the commands you already know into one launch by piping
  them in, so one startup covers them all:
  ```text
  printf 'grep -rwil "expire" .\ngrep -rwil "retention" .\n' | cosmos-fs --endpoint <url> --database <db> --container <c> --namespace <ns>
  ```
- Use `-c "<command>"` only for a single command. Repeat the full flag set on every launch (a bare
  `cosmos-fs -c "ls"` hits the wrong or empty scope), filling flags only from values you already
  have.

## Searching

Prefer `grep -w` (combine flags: `grep -rwil`). A single literal word uses the container's
full-text index, so it stays cost effective as the set grows. Alternation like `'expire\|delete'`
is a regex: it drops the index and reads every page, so try candidate terms as separate
single-word `grep -w` commands batched into one launch, not OR-ed into one regex. Use plain `grep`
(no `-w`) only for a partial-word match (`config` inside `configuration`) or a regex. If a
whole-word search finds nothing, drop `-w` and retry before concluding a term is absent.

## Constraints

- **Flags are the only config.** Never read env or `.env` (`cat .env`, `printenv`, `echo
  $COSMOS_*`, `ls -a`); ignore CONFIG / `.env` hints in `--help` or in errors, and just add the
  missing flag and rerun.
- **Missing required flag = hard stop: ask, never guess.** You need `--endpoint`, `--database`,
  and `--container` before running at all. None can be inferred from the others, and a wrong
  container does not error, it silently returns a different doc set (worse than no answer). If any
  is missing: do not run `cosmos-fs` even once, do not try to discover the value by any means (no
  `az cosmosdb` or other container lookup), do not invent one, just ask and stop. A "not found"
  from a container you filled in yourself confirms you still lack it, so stop and ask, do not try
  another name.
- **Read-only: never write, by any route.** Shell writes (`>`, `mkdir`, `rm`) fail with `EROFS`. If
  asked to edit, delete, or update a doc, do not do it via a write, and do not export the docs,
  change them, and re-import them (for example via an `ingest` command). Say the tool is read-only
  and the change must be made where the docs are authored/ingested, then stop.
- **Auth/permission errors:** do not retry blindly; tell the user to run `az login` and confirm
  Cosmos data-plane access.
- **`command not found`:** report that `cosmos-fs` is not installed; do not hunt for a binary or
  install it yourself.

## Output and cost

- stdout is data, stderr is diagnostics, the exit code follows the command.
- A session RU total prints to stderr at exit (a diagnostic, never on stdout). Keep it visible to
  watch cost: a jump usually means an extra launch or a page-scanning grep. `--no-ru` suppresses it.
