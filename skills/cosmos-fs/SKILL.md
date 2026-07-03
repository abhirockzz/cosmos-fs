---
name: cosmos-fs
description: Explore and search a document set stored in Azure Cosmos DB through the read-only cosmos-fs CLI, using shell commands (ls, cd, find, cat, grep). Use when answering questions from a document set indexed with cosmos-fs, browsing ingested docs, code, or notes, or when the user mentions cosmos-fs, a Cosmos DB document set, or a docs container to search.
---

# cosmos-fs: explore documents like a filesystem

`cosmos-fs` is a read-only shell over documents stored in Azure Cosmos DB. Each stored
item is a file, and you browse and search with `ls`, `cd`, `find`, `cat`, and `grep`,
reading whole pages.

## Before you start

- Run `cosmos-fs --help` once to see the commands and configuration.
- It needs an Azure sign-in (`az login`) and a target container set in the environment,
  a `.env` file, or flags (`--endpoint`, `--database`, `--container`, `--namespace`).
- If a command fails with an auth or permission error, tell the user to run `az login`
  and confirm they have Cosmos data-plane access. Do not retry blindly.

## Two ways to run

Answering a real question usually takes several commands: you search, read what matched, and
often search again with a sharper term. Each command depends on the previous output, so you
cannot write them all up front.

- (Recommended) Interactive, `cosmos-fs` with no `-c`: opens one shell for the whole exploration. The file
  tree is built once, the working directory persists, and you send commands as you decide
  them. Prefer this for anything beyond a single command, whenever your runtime can keep a
  shell open and send commands to it.
- One-shot, `cosmos-fs -c "<command>"`: runs a single command and exits with its code. Each
  call is independent, so it builds the tree and signs in again, and the working directory
  starts at the root. Use it for a single command, or when your runtime only runs isolated
  commands. You can chain a *fixed* sequence with `&&` (`cosmos-fs -c "cd query && ls"`), but a
  search-then-read flow cannot be chained: the page you read depends on what the search returns.

## What you can rely on

- Read-only: every write (`>`, `mkdir`, `rm`, and so on) fails with `EROFS`. It is safe to
  run in an autonomous loop, so never attempt to modify data.
- Output contract: stdout is data, stderr is diagnostics, and the exit code follows the
  command. Read stdout for results.

## Search efficiently

For a term or phrase, prefer `grep -w` (combine flags freely: `grep -rwl`, `grep -rwil`). It
uses the container's full-text index when one exists, so it stays cost effective as the document set
grows, and its results match a plain `grep -w`. Use plain `grep` (no `-w`) only for a
partial-word match (like `config` inside `configuration`) or a regex, which read every page.
When a whole-word search returns nothing, drop `-w` and search again before concluding the
term is absent.

## Worked examples

Each starts from a user question in natural language. You do not know the path, so search for
a likely term, read the top hit, then answer and cite it. All commands and output below are
real (shown as an interactive session; in one-shot mode prefix each with `cosmos-fs -c`).

**"How do I get an array's length in a NoSQL query?"** — one page matches, read its syntax:

````text
/ $ grep -rwil "array length" .
query/array-length.md
/ $ cat query/array-length.md | grep -A3 '## Syntax'
## Syntax
```cosmos-db
ARRAY_LENGTH(<array_expr>)
````

Answer: use `ARRAY_LENGTH(<array_expr>)`, citing `query/array-length.md`.

**"How do I run a vector search?"** — several pages match, so pick the query-function page:

````text
/ $ grep -rwil "vector search" .
hybrid-search.md
index-vector-data.md
query/vectordistance.md
...
/ $ cat query/vectordistance.md | grep -A3 '## Syntax'
## Syntax
```cosmos-db
VECTORDISTANCE(<vector_expr_1>, <vector_expr_2>, <bool_expr>, <obj_expr>)
````

Answer: use `VECTORDISTANCE(...)`, citing `query/vectordistance.md`.

**"Which query functions work on arrays?"** — a cross-page question; read the grouped index once:

```text
/ $ cat query/functions.md | grep -A13 '### Array functions'
### Array functions
| ... | ARRAY_CONCAT, ARRAY_CONTAINS_ALL, ARRAY_CONTAINS_ANY, ARRAY_CONTAINS,
        ARRAY_LENGTH, ARRAY_SLICE, CHOOSE, OBJECTTOARRAY, SETINTERSECT, SETUNION |
```

Answer: list the array functions from `query/functions.md`. One read covers the whole
category.
