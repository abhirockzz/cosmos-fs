# Quickstart: use cosmos-fs as an AI agent tool

Give an AI agent read-only access to your documents by letting it shell out to
`cosmos-fs -c "..."`. No SDK, no MCP server, no write risk. This uses
the `nimbus-docs` document set from [Index your own docs](01-index-your-docs.md), but any
document set works.

**Prerequisite:** finish [Setup](setup.md) and load at least one document set
([QS1](01-index-your-docs.md) or [QS2](02-map-existing.md)).

## Try it

In VS Code, open Copilot Chat, switch to **Agent mode**, and nudge it toward the tool:

```text
Use the cosmos-fs CLI (run: cosmos-fs --help) to answer from our docs: how does the API handle 429 errors?
```

The agent checks `--help`, then browses and searches the documents on its own and answers.
That is the whole integration: name the tool and ask. Swap in your own question; any
shell-capable agent works the same way.

## How it works (optional)

You don't need this to use the tool, but here is what usually happens.
`cosmos-fs` is just a terminal command, so the agent first runs `cosmos-fs --help` to see
what it can do, then explores on its own, roughly:

1. `cosmos-fs -c "ls"` (or `find .`) to get the lay of the land.
2. `cosmos-fs -c "grep -rn <term> ."` to locate the pages that mention the topic.
3. `cosmos-fs -c "cat <path>"` to read the most relevant one, then answer from it.

Treat that as a sketch, not a script: the exact commands vary from run to run, since agents
phrase searches differently and adapt as they learn the documents. What always holds is that
`cosmos-fs` is **read-only**, so the agent cannot change your data even by mistake.

```bash
cosmos-fs -c "rm faq.md"
```

```
rm: cannot remove 'faq.md': EROFS: read-only file system, unlink '/faq.md'
```

For the stdout/stderr/exit-code contract and how `cat` and `grep` work under the hood, see
[cli.md](../cli.md#for-agents) and [concepts.md](../concepts.md).

## Troubleshooting

- **The agent finds nothing.** Wrong namespace or container. Check `.env`, then see
  [QS1](01-index-your-docs.md#troubleshooting) and [QS2](02-map-existing.md#troubleshooting).
- **The agent tries to write.** Reinforce "read-only" in the prompt. The tool refuses writes
  regardless, returning `EROFS`.

## Next

- [docs/recipes.md](../recipes.md) for more worked navigate/search/read loops.
- `cosmos-fs --help` for the full command reference.
