---
name: migrate-generic-to-documentation-ai
description: Move any other documentation site onto Documentation.AI: a Markdown, MDX or HTML repository, a Docusaurus, Nextra, Fern or MadCap Flare project, or a live site found through its sitemap, sidebar and links. Use when asked to migrate, import or move documentation that is not Mintlify, GitBook, ReadMe or Document360, or when the platform is not known yet.
---

# Migrate any other site to Documentation.AI

## Start here

Read `references/how-a-migration-runs.md` first, in full. It carries what every migration shares: how to ask a person the four decisions (choices to click, never a sentence to type), the stages in order, the delivery flows, and what the migrator will not guess at. This skill adds only what is specific to these sources.

For sites with no export, API or source repo, or for platforms without a dedicated skill.

## Procedure
At every gate, ask the way the shared workflow says (`references/how-a-migration-runs.md`) says: a short summary, then choices the person can click, first option approves; on approval record it under the name they gave at the start and carry on with the next stages in the same turn. Never ask them to type "approve gate N".
1. `dai-migrate discover --url <site>` unions recursive sitemap indexes (including robots-declared and gzip maps), sidebar links, the recursive same-origin link graph, and Firecrawl `/map` when selected. Sidebar order wins; sitemap order is the fallback. Sitemap filenames may supply conservative group, locale, and version hints when the URL path does not. **Human gate 1/4:** review `inventory/sitemaps.json` and `plan/tree.yaml`; a sitemap is an inventory, not authoritative navigation.
2. `dai-migrate acquire --profile generic`: batch scrape of the confirmed list through Firecrawl (explicit settings) or the local fetcher; content-addressed cache; robots honoured unless `--customer-authorised`.
3. `dai-migrate inventory`: everything with a class or a non-standard tag is a component candidate; `details`, `iframe`, `video`, tables, code, images.
4. `dai-migrate plan`: `mappings/generic.yaml`; unknown clusters need review and become a sanitised T7 fragment only when explicitly approved, otherwise they are quarantined. **Human gate 2/4:** approve the complete conversion plan. Automatic T6 rule proposal is not implemented.
5. `assets` → `convert` twice → `nav` → local `verify` → **human gate 3/4** → `write --push` (or `publish` in the MCP flow) → `verify --preview` → **human gate 4/4** → `release` (writes the immutable cutover certificate) → `report`.
