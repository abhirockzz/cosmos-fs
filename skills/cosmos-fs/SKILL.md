---
name: cosmos-fs
description: Explore and search a document set stored in Azure Cosmos DB through the read-only cosmos-fs CLI, using shell commands (ls, cd, find, cat, grep). Use when answering questions from a document set indexed with cosmos-fs, browsing ingested docs, code, or notes, or when the user mentions cosmos-fs, a Cosmos DB document set, or a docs container to search.
---

# cosmos-fs: explore documents like a filesystem

`cosmos-fs` is a read-only shell over documents stored in Azure Cosmos DB. Each stored
item is a file, and you browse and search with `ls`, `cd`, `find`, `cat`, and `grep`,
reading whole pages.

## Running cosmos-fs

`cosmos-fs` needs an Azure sign-in (`az login`) and its target passed as flags. Every
invocation follows one canonical form:

```text
cosmos-fs --endpoint <url> --database <db> --container <c> --namespace <ns> [-c "<command>"]
```

Answering a question usually takes several commands: search, read what matched, then search
again with a sharper term. Each depends on the previous output, so **default to interactive** —
launch once with the flags above and keep the shell open, sending commands one at a time. The
launch command carries the flags; the commands you send into the shell afterward are bare. Use
one-shot (`-c "<command>"`) only for a single command or when your runtime cannot keep a shell
open; it re-authenticates and rebuilds the tree on every call, and you must repeat the full flag
set each time (a bare `cosmos-fs -c "ls"` runs against the wrong or empty scope).

Constraints:

- **Flags are the only configuration source.** Do not read or search for env vars or a `.env`
  file (no `cat .env`, `printenv`, `echo $COSMOS_*`, `ls -a`), and ignore the CONFIG / `.env`
  hints in `--help`. If you are missing a flag value, ask the user for it.
- **Ignore env/`.env` advice in errors.** If a command fails with a "Missing Cosmos ..." error
  that suggests setting a `COSMOS_*` variable or copying `.env.example` to `.env`, add the
  missing flag and rerun instead.
- **On auth or permission errors, do not retry blindly.** Tell the user to run `az login` and
  confirm they have Cosmos data-plane access.

## What you can rely on

- Read-only: every write (`>`, `mkdir`, `rm`, and so on) fails with `EROFS`. It is safe to
  run in an autonomous loop, so never attempt to modify data.
- Output contract: stdout is data, stderr is diagnostics, and the exit code follows the
  command. Read stdout for results.
- Session RU total: when the session ends (shell exit/EOF, or after a `-c` one-shot) a
  one-line request-unit total prints to stderr. It is a diagnostic, never on stdout, so it
  does not affect result parsing. Pass `--no-ru` to suppress it.

## Search efficiently

For a term or phrase, prefer `grep -w` (combine flags freely: `grep -rwl`, `grep -rwil`). It
uses the container's full-text index when one exists, so it stays cost effective as the document set
grows, and its results match a plain `grep -w`. Use plain `grep` (no `-w`) only for a
partial-word match (like `config` inside `configuration`) or a regex, which read every page.
When a whole-word search returns nothing, drop `-w` and search again before concluding the
term is absent.

## Worked examples

Each starts from a user question in natural language. You do not know the path, so search for
a likely term, read the top hit, then answer and cite it.

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
