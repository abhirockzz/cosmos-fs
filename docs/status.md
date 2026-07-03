# cosmos-fs feature status

Glance-only board of what works, what's in flight, and what's planned. The how and why live in
[PLAN.md](../PLAN.md); non-obvious findings in [LEARNINGS.md](../LEARNINGS.md). This file tracks
state only, so it should not repeat design detail (link instead).

_Last updated: 2026-07-03. Phase 8 complete: a document-search product (schema rename, read-time field mapping, ingest writer + CLI, docs) plus dogfooded end-to-end quickstarts and task guides. Phase 9 (cheap `grep -w` via full-text index) in flight. See [PLAN.md](../PLAN.md)._

Status legend: **Done** · **Next** (in flight) · **Planned** · **Later** (optional).

| Capability | Status | Notes |
| --- | --- | --- |
| Provision + ingest | Done | one item per page; AAD; container `pages` holds 183 items; schema `namespace`/`key`/`content`, PK `/namespace`; `id=base64url(key)` (no `%`) |
| `ls` / `cd` / `find` (tree navigation) | Done | in-memory tree built from item keys |
| Read-only enforcement | Done | every write throws `EROFS` |
| `cat` (read an item's full text) | Done | one point read per item (~1 RU); see [LEARNINGS.md](../LEARNINGS.md) on `%`-id + `defenseInDepth` |
| `grep` (coarse Cosmos filter → in-memory fine match) | Done | one `CONTAINS` query (literal) or fetch-all (regex/`-v`); fine match delegates to built-in grep; pipes read stdin |
| `grep -w` whole-word search (full-text index) | Next | literal `-w` routes to `FullTextContainsAll` coarse (index-accelerated, RU flat with corpus) then fine `grep -w`; byte-identical; auto-detects the full-text index and falls back to the scan without it; index is default in provisioning |
| Core engine (`openCorpus`/`Session`) | Done | data-agnostic reusable seam; one exec API for CLI + agents; AAD credential seam |
| Packaged CLI (`cosmos-fs` binary) | Done | `bin` + shebang; `--help`/`--version`, `-c` one-shot + REPL, `--endpoint/...` flags + mapping flags; `ingest <folder>` writer subcommand; stdout=data/stderr=diagnostics |
| Schema rename `site/path/content` → `namespace/key/content` (Phase 8a) | Done | `id=base64url(key)`, PK `/namespace`; migrated via gated re-provision + re-ingest (183 items) |
| Read-time field mapping (Phase 8b) | Done | bind roles to existing fields (single-field, nested paths); resolver + startup `key→id` index + PK auto-detect; proven on a live LangChain-shaped fixture (PK `/id`) |
| Ingest writer + `cosmos-fs ingest` folder CLI (Phase 8c) | Done | records→Cosmos-correct upsert (`src/writer.ts`, full-refresh); `cosmos-fs ingest <folder>` walks .md/.mdx/.markdown/.txt; PDF/chunking stay at the edge |
| Documentation (user-facing, world-class bar) (Phase 8d) | Done | concepts + README/cli/ingest/recipes/`--help` polished + cross-linked (roles/how-it-works single-sourced in `concepts.md`); every command example run green |
| Quickstarts (setup + index + map + agent) | Done | end-to-end guides in `docs/quickstarts/`; each dogfooded against the live tool |
| Task guides (namespaces, PDFs) | Done | deeper walkthroughs in `docs/guides/`; each dogfooded against the live tool |
| Agent skill (lightweight, over the binary) | Later | form factor 3; thin SKILL doc pointing at `cosmos-fs -c` |
| MCP server (single read-only `bash` tool) | Later | optional; only if needed |

Update the row and the "Last updated" line whenever a capability changes state (at each phase boundary).
