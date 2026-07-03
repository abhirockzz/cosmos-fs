# cosmos-fs

A read-only shell over a set of documents stored in Azure Cosmos DB for NoSQL. Explore your data
(docs, code, notes, anything you ingest) with ordinary shell commands: `ls`, `cd`, `find`,
`cat`, and `grep`.

It maps onto what Cosmos DB does well: `ls`/`cd`/`find` traverse an in-memory tree built from
one startup query, `cat` is a ~1-RU point read, and `grep` is a single query. Whole-word
searches (`grep -w`) use a full-text index, so they stay cheap as your data grows. It is
read-only: every write fails with `EROFS`, so it is safe to hand to an agent.

## Install

Requires Node >= 20, pnpm, and an Azure sign-in with data-plane access to your Cosmos
account (`az login`; AAD only, no keys).

```bash
pnpm install
pnpm build     # builds the cosmos-fs binary to dist/cli.js
npm link       # optional: puts `cosmos-fs` on your PATH
```

## Configure

Point the tool at your Cosmos container with environment variables (or a `.env` file,
or flags). Only the endpoint is required.

| Setting | Env var | Default |
| --- | --- | --- |
| Account endpoint | `COSMOS_ENDPOINT` | _(required)_ |
| Database | `COSMOS_DATABASE` | `docs` |
| Container | `COSMOS_CONTAINER` | `pages` |
| Document set / scope (partition key) | `COSMOS_FS_NAMESPACE` | _(optional: whole container)_ |

```bash
cp .env.example .env    # then set COSMOS_ENDPOINT
```

Flags override the environment, e.g. `cosmos-fs --endpoint <url> --namespace <name>`.

## Use

```bash
cosmos-fs -c "ls query"                     # one-shot: run a command, exit with its code
cosmos-fs -c "grep -rn 'partition key' ."   # search content (recursive)
cosmos-fs -c "grep -rwl throughput ."       # whole-word search (uses the full-text index)
cosmos-fs -c "cat overview.md | head -20"   # read an item and pipe it
cosmos-fs                                   # interactive shell (cwd persists)
```

`cosmos-fs --help` is the full command reference; [docs/cli.md](docs/cli.md) is a short
guide. (To try it from source without building, use `pnpm cli -c "..."`.)

## Bring your own data

cosmos-fs only reads what is already in the container. You can either **write** items in the
shape it expects, or **map** the reader onto an *existing* container's fields.

```bash
# Write: upload a local text/markdown folder (one item per file) into a namespace
cosmos-fs ingest ./my-notes --namespace my-notes

# Map: explore an existing (e.g. LangChain-shaped) container with no re-ingest
cosmos-fs --container my-vectors --content-field text --key-field metadata.source -c "ls"
```

New to the model? [docs/concepts.md](docs/concepts.md) covers the roles and how it works.
The writer, provisioning, and mapping details are in [docs/ingest.md](docs/ingest.md).

## Quickstarts

Step-by-step guides that take you from an empty account to exploring your documents:

- [Setup and prerequisites](docs/quickstarts/setup.md): Azure sign-in, data-plane role, install.
- [Index your own docs](docs/quickstarts/01-index-your-docs.md): load a local folder and explore it.
- [Explore an existing container](docs/quickstarts/02-map-existing.md): map cosmos-fs onto data you already have.
- [Use cosmos-fs as an AI agent tool](docs/quickstarts/03-agent-tool.md): wire it into an agent loop.

## Guides

Task-focused walkthroughs once you're set up:

- [Separate document sets with namespaces](docs/guides/namespaces.md): keep several document sets in one container.
- [Ingest PDFs](docs/guides/pdfs.md): convert and index PDF content.

## Docs

- [docs/concepts.md](docs/concepts.md): the model (roles, how it works). Start here.
- [docs/cli.md](docs/cli.md): using the CLI (or run `cosmos-fs --help`).
- [docs/recipes.md](docs/recipes.md): worked examples (navigate, search, read).
- [docs/ingest.md](docs/ingest.md): provision and load your own data.
- [docs/status.md](docs/status.md): what works today.

## License

MIT. See [LICENSE](LICENSE). Provided as-is; point it at your own Cosmos DB and adapt it.
