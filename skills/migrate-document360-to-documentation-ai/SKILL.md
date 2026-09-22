---
name: migrate-document360-to-documentation-ai
description: Move a Document360 knowledge base onto Documentation.AI, from an export ZIP or its live site: Articles, Categories, workspace metadata, snippet tokens and media, converted from HTML. Use when asked to migrate, import or move Document360 documentation.
---

# Migrate Document360 to Documentation.AI

## Start here

Read `references/how-a-migration-runs.md` first, in full. It carries what every migration shares: how to ask a person the four decisions (choices to click, never a sentence to type), the stages in order, the delivery flows, and what the migrator will not guess at. This skill adds only what is specific to Document360.

Implemented source preference: **export ZIP/directory** → live URL acquisition with the Document360 profile → generic profile. A Document360 API client is not implemented in this version.

## Procedure
At every gate, ask the way the shared workflow says (`references/how-a-migration-runs.md`) says: a short summary, then choices the person can click, first option approves; on approval record it under the name they gave at the start and carry on with the next stages in the same turn. Never ask them to type "approve gate N".
1. `documentation-ai-migrate discover --export <zip|dir>`: reads `<workspace>_category_articles.json` and `Articles/`, writes `plan/tree.yaml` (category path, order, format html|md, workspace, language) and lists `unplaced` entries. **Human gate 1/4:** confirm scope; if the export mixes workspaces or languages, confirm which ones are in scope.
2. `documentation-ai-migrate inventory`: components (infoBox/warningBox/errorBox/successBox, details, editor360-faq, tabs, tables, iframes, custom HTML), assets under `Media/`, links, heading ids, and **snippet tokens** (`{{snippet.X}}`). Snippet bodies are not in the export. Add operator-supplied bodies and resolution decisions to `inventory/snippets.json`; unresolved tokens keep affected pages quarantined.
3. `documentation-ai-migrate plan`: **human gate 2/4** reviews the combined snippet decisions, `plan/component-plan.yaml`, `plan/urls.yaml` and `plan/assets.yaml`.
4. `documentation-ai-migrate assets` → `convert` twice → `nav` → local `verify` → **human gate 3/4** → `write --push` (or `publish` in the MCP flow) → `verify --preview` → **human gate 4/4** → `release` (writes the immutable cutover certificate) → `report`. The branch name is generated as `migration/<session>`.

## Known traps (from the Scrut run)
- Random heading ids (`mkdmggx4-…`) are dropped; text slugs regenerate identically. Anchor shims are only emitted where an inbound link targets a non-slug id.
- `&amp;`-encoded and `%20` media names: unescape before matching `Media/`.
- Markdown-editor articles (`.md`) use the MDX adapter, not the HTML one.
- Confirm the category JSON schema on the first real export and add it as a fixture; the adapter tolerates unknown shapes but logs `unplaced` entries you must review.
