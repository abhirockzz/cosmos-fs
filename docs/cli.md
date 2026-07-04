# cosmos-fs CLI

A read-only shell over a set of documents stored in Azure Cosmos DB. Explore whatever
you ingested (docs, code, notes, anything) with `ls`, `cd`, `find`, `cat`, and `grep`,
plus `info` to see what this session is connected to.

**`cosmos-fs --help` is the full reference.** This page is the short version. New to
cosmos-fs? [concepts.md](concepts.md) explains the model.

## Setup

- Sign in: `az login` (auth is Azure AD only, no keys).
- Point at your data via env / `.env` (or flags): `COSMOS_ENDPOINT` (required), plus
  optional `COSMOS_DATABASE`, `COSMOS_CONTAINER`, `COSMOS_FS_NAMESPACE`. Copy `.env.example`
  to `.env` to start.
- To explore an *existing* container whose fields differ, add `--content-field`,
  `--key-field`, and/or `--namespace-field` (see `--help` and
  [ingest.md](ingest.md#explore-an-existing-container-field-mapping-no-re-ingest)).
- Build the binary: `pnpm install && pnpm build` puts the entry at `dist/cli.js` (`npm link`
  to expose it as `cosmos-fs`). For development, `pnpm cli` runs the source via tsx.

To load data, use `cosmos-fs ingest <folder>` (see [ingest.md](ingest.md)); everything else
here reads what is already in the container.

## Run

One-shot mode exits with the command's status code (ideal for scripts and agents):

```bash
cosmos-fs -c "ls query"
cosmos-fs -c "cat overview.md | head -20"
cosmos-fs -c "grep -rn 'partition key' ."
cosmos-fs -c "grep -rwl throughput ."     # whole-word search (uses the full-text index)
cosmos-fs -c "find . | grep advisor"      # grep also filters piped input
```

Interactive shell (cwd persists across commands). Leave with `exit`, `quit`, or Ctrl-D:

```bash
cosmos-fs
/ $ cd query && ls | head -3
```

Config flags override env, e.g. `cosmos-fs --endpoint <url> --namespace <name> -c "ls"`.

## For agents

The binary is the whole interface (no SDK required):

- Instruct the agent to run `cosmos-fs -c "<command>"` and read **stdout** (data) and
  **stderr** (diagnostics); the exit code follows the command.
- It is read-only: every write (`>`, `mkdir`, `rm`, ...) fails with `EROFS`, so it is
  safe to hand to an autonomous loop.

## Notes

- `info` prints the resolved connection (endpoint, database, container, namespace), the
  file count, and how item roles map to fields — handy in one-shot mode where the REPL
  banner isn't shown.
- Beyond `ls`/`cd`/`find`/`cat`/`grep`, the standard read-only text toolkit is available
  (`head`, `tail`, `sort`, `uniq`, `cut`, `tr`, `nl`, `wc`, `sed`, `awk`, `jq`, `yq`, ...).
  Run `help` to list commands and `<cmd> --help` for usage. Writes are the only thing
  disabled (they fail with `EROFS`).
- Cost: only `cat`, `grep`, and the one-time startup build query Cosmos. `ls`/`cd`/`find`
  and every other text tool run in memory over piped output, so they add 0 RU.
- Every run prints a one-line RU total to **stderr** on exit (e.g. `cosmos-fs: session used
  1.03 RU.`). It never touches stdout, so it won't pollute piped or parsed output. Pass
  `--no-ru` to hide it.
- Pipes work: `find . | grep ...`, `cat p | grep ...`, `... | head / sort / wc -l`. Piped
  input is filtered instead of the document set.
- Whole-word search is cost effective: `grep -w` uses the container's full-text index when it has one,
  so it stays fast as the document set grows. Plain `grep` scans for substrings and regex.
- Read-only: any write fails with `EROFS`, so it is safe for automated use.
- For why it stays cost effective (point reads, one-query tree, coarse-to-fine grep), see
  [concepts.md](concepts.md).

