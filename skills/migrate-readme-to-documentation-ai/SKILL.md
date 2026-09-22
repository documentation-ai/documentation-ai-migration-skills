---
name: migrate-readme-to-documentation-ai
description: Move a ReadMe project onto Documentation.AI, from its bi-directional sync repository, the ReadMe API, or its live site: categorized Markdown, ReadMe frontmatter, callouts and components. Use when asked to migrate, import or move ReadMe documentation.
---

# Migrate ReadMe to Documentation.AI

## Start here

Read `references/how-a-migration-runs.md` first, in full. It carries what every migration shares: how to ask a person the four decisions (choices to click, never a sentence to type), the stages in order, the delivery flows, and what the migrator will not guess at. This skill adds only what is specific to ReadMe.

Implemented source preference: **sync repository** (`docs/<category>/*.md`, frontmatter `title`, `slug`, `excerpt`, `hidden`, `order`) → **API v2** (`README_API_KEY`; `/branches/{branch}/guides|reference|categories`, bodies from `content.body`) → live URL acquisition with the ReadMe scrape profile (`.md` suffix first, then `.rm-Markdown.markdown-body`).

## What the adapters do
- Sync repo: category folders become groups, `hidden: true` pages are skipped and listed, `order` is respected, `parentDocSlug` nests.
- API v2: paginated lists, per-page bodies, hidden pages excluded, tree grouped by section (Guides, Reference) and category.
- Markdown adapter with `platform: readme`: `> 📘 / 👍 / 🚧 / ❗` blockquotes become `Callout` kinds; `mappings/readme.yaml` covers Accordion → Expandable, Cards → Columns + Card, Columns, Image prop drops, Tabs, embeds, Recipes (when the body is present).

## Procedure
At every gate, ask the way the shared workflow says (`references/how-a-migration-runs.md`) says: a short summary, then choices the person can click, first option approves; on approval record it under the name they gave at the start and carry on with the next stages in the same turn. Never ask them to type "approve gate N".
1. `documentation-ai-migrate init ... --repo <sync-repo> --platform readme` (or `--source https://<subdomain>.readme.io` for API or scrape).
2. `documentation-ai-migrate discover` → **human gate 1/4**: review `plan/tree.yaml`; hidden pages are in `inventory/platform-meta.json`.
3. `inventory` → `plan` → **human gate 2/4** (variables, glossary terms, Recipes without bodies and marketplace components) → `assets` → `convert` twice → `nav` → local `verify` → **human gate 3/4** → `write --push` (or `publish` in the MCP flow) → `verify --preview` → **human gate 4/4** → `release` (writes the immutable cutover certificate) → `report`.

Not implemented: API reference generation from ReadMe's OpenAPI uploads (export the spec and use the Mintlify-style group-level `openapi` in `documentation.json` manually), variables and glossary substitution, Changelog → Update conversion.
