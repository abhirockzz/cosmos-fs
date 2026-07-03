# cosmos-fs recipes

Worked examples of the navigate → search → read loop, run against a live Cosmos DB for
NoSQL document set (the Azure Cosmos DB docs). Each recipe gives the exact commands and
what they return; adapt the paths to your own corpus. Everything here is read-only, so the
commands are safe to run as-is.

New to cosmos-fs? [Index your own docs](quickstarts/01-index-your-docs.md) is a guided
first run on a small sample. Commands below run as one-shots (`cosmos-fs -c "<command>"`,
or `pnpm cli -c "..."` from source); in an interactive session, drop the `cosmos-fs -c`
wrapper and type the command alone.

---

## 1. Discover the documents like an unfamiliar repo

Goal: an agent lands with no map and needs to learn the layout, then locate a topic.

```bash
cosmos-fs -c "ls"                          # root: concept pages + a query/ dir
cosmos-fs -c "cd query && ls | head"       # query/ is the function reference (~180 pages)
cosmos-fs -c "find . -type d"              # shallow tree: ., ./query, ./query/advisor
cosmos-fs -c "find . -name 'fulltext*'"    # locate a topic by name
```

Shows: navigation is pure in-memory tree traversal (no Cosmos calls after startup),
and `find` locates pages by name without reading any content. The last command
returns the four full-text function pages under `query/`.

## 2. Read a specific page

Goal: open a page whose path is known.

```bash
cosmos-fs -c "cat overview.md"                 # concept page (frontmatter + body)
cosmos-fs -c "cat query/array-length.md"       # a function reference page
```

Shows: `cat` is a single point read keyed by the item's key + partition key (~1 RU per page).

## 3. Search, then read (the headline loop)

Goal: "How do I get an array's length in a Cosmos DB NoSQL query?" The agent does not
know the path, so it searches content, then reads the top hit.

```bash
cosmos-fs -c "grep -rwl ARRAY_LENGTH ."    # which pages mention it -> array-length.md, functions.md
cosmos-fs -c "cat query/array-length.md"   # read the top hit for exact syntax + examples
```

Shows: the full navigate -> search -> read loop. `-w` searches whole words through the
container's full-text index, so it stays cost effective as the set grows; without `-w`, `grep` pushes
a coarse `CONTAINS` filter and scans. `cat` reads the winning page.

## 4. Other search shapes

Goal: line-level hits and filtering a stream.

```bash
cosmos-fs -c "grep -n ARRAY_LENGTH query/array-length.md"   # line numbers within one file
cosmos-fs -c "cat query/array-length.md | grep -n ARRAY_LENGTH"   # grep over piped stdin
```

Shows: `grep` works over a single file and over a piped stream, with `-n`/`-i`/`-l`
flags behaving like real grep.

## 5. Answer a category question, then show a signature

Goal: "Which query functions work on arrays? Show one signature." The agent does not
know the pages, so it reads the array category in the function index, then opens one
page for its exact syntax.

```bash
cosmos-fs -c "cat query/functions.md | grep -A13 '### Array functions'"   # the 10 array functions
cosmos-fs -c "cat query/array-length.md | grep -A3 '## Syntax'"   # one signature: ARRAY_LENGTH(<array_expr>)
```

Shows: `functions.md` groups the reference by category, so a single `cat | grep` lists
all ten array functions (`ARRAY_CONCAT`, `ARRAY_CONTAINS_ALL`, `ARRAY_CONTAINS_ANY`,
`ARRAY_CONTAINS`, `ARRAY_LENGTH`, `ARRAY_SLICE`, `CHOOSE`, `OBJECTTOARRAY`,
`SETINTERSECT`, `SETUNION`) without opening a function page. Reading one of those pages
then yields the exact signature, `ARRAY_LENGTH(<array_expr>)`.

## 6. Explore an existing container

cosmos-fs can also browse a container it did **not** write, by binding its roles to the
container's own fields (`--content-field`, `--key-field`, `--namespace-field`). A
LangChain-style store whose text is in `text` and whose path is in `metadata.source`
becomes browsable with no re-ingest:

```bash
cosmos-fs --content-field text --key-field metadata.source -c "find . -type f | sort"
cosmos-fs --content-field text --key-field metadata.source -c "grep -rl OAuth ."
```

For a full, runnable walkthrough with a seeded example container, see
[Explore an existing container](quickstarts/02-map-existing.md).
