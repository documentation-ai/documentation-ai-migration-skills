---
name: migrate-generic-to-documentation-ai
description: Move any other documentation site onto Documentation.AI: a Markdown, MDX or HTML repository, a Docusaurus, Nextra, Fern or MadCap Flare project, or a live site found through its sitemap, sidebar and links. Use when asked to migrate, import or move documentation that is not Mintlify, GitBook, ReadMe or Document360, or when the platform is not known yet.
---

# Migrate any other site to Documentation.AI

## Start here

Read `references/how-a-migration-runs.md` first, in full. It carries what every migration shares: how to ask a person the four decisions (choices to click, never a sentence to type), the stages in order, the delivery flows, and what the migrator will not guess at. This skill adds only what is specific to these sources.

For sites with no export, API or source repo, or for platforms without a dedicated skill.

## A Fern repository

Use the repository (the folder holding `fern/docs.yml`), not the live site: `init --source <repo folder>` reads `docs.yml` and the version and product files it names.

- **Addresses are Fern's own.** Every page keeps the address Fern serves it at: a tab, section or page adds its title made a slug (lodash's kebabCase, so "SDKs" is `sd-ks`) unless it states `slug:`; `skip-slug: true` adds nothing; a page's frontmatter `slug` replaces the whole path below the version or product; a folder's pages are named after their files; the default version is served without its prefix (the prefixed address redirects). Tell the person at gate 1 when the tree shows an address they may not expect, such as `sd-ks`: it is the address their readers and links already use.
- **API reference.** Each `api:` section becomes a navigation group Documentation.AI fills with one page per endpoint from the same OpenAPI spec (found through `generators.yml`, in `fern/` or `fern/apis/<api-name>/`); endpoints Fern hides (`x-fern-ignore`, or an audience the section does not show) stay hidden. Every address Fern served an endpoint at redirects to the platform's page for it, so old API links keep working. `discover` names each section, its spec and its endpoint count: say so at gate 1. A section with no OpenAPI spec (a Fern Definition) is listed as missing; tell the person to export it with `fern export` and migrate that.
- **Redirects** in `docs.yml` carry over, wildcards included.
- **Components** convert by `mappings/fern.yaml` (callouts, tabs, cards, accordions, expandables, steps, code groups, frames, parameter fields). `<Code src>` and `<Markdown src>` are read as the file they include; `<CodeBlock title>` gives its title to the code block; a button is the link it opens. MDX comments are author notes, never shown to readers, and are not carried.
- **Pictures** in the repository are read from it, including root paths (`/assets/x.png` is looked up under `fern/` first). They have no public address, so `assets` puts them in `<workspace>/upload` and asks the person to drop them on the project's upload page once (see Pictures in `references/how-a-migration-runs.md`).
- **The look** (title, logo, favicon, accent colours, top-bar links) comes from `docs.yml`, never fetched from the live site.
- **Not migrated as pages:** `link:` entries or link tabs, which `discover` lists by name.
- **Never tell the person something carries over before `discover` has said so.** Read its notes and `inventory/platform-meta.json` (`openapi`, `redirects`) and report what they show.

## Procedure
At every gate, ask the way the shared workflow says (`references/how-a-migration-runs.md`) says: a short summary, then choices the person can click, first option approves; on approval record it under the name they gave at the start and carry on with the next stages in the same turn. Never ask them to type "approve gate N".
1. `documentation-ai-migrate discover --url <site>` unions recursive sitemap indexes (including robots-declared and gzip maps), sidebar links, the recursive same-origin link graph, and Firecrawl `/map` when selected. Sidebar order wins; sitemap order is the fallback. Sitemap filenames may supply conservative group, locale, and version hints when the URL path does not. **Human gate 1/4:** review `inventory/sitemaps.json` and `plan/tree.yaml`; a sitemap is an inventory, not authoritative navigation.
2. `documentation-ai-migrate acquire --profile generic`: batch scrape of the confirmed list through Firecrawl (explicit settings) or the local fetcher; content-addressed cache; robots honoured unless `--customer-authorised`.
3. `documentation-ai-migrate inventory`: everything with a class or a non-standard tag is a component candidate; `details`, `iframe`, `video`, tables, code, images.
4. `documentation-ai-migrate plan`: `mappings/generic.yaml`, after the source platform's own table when it has one here (`mappings/fern.yaml`); unknown clusters need review and are kept as a sanitised T7 fragment, flagged for a person, unless excluded or quarantined in the plan. **Human gate 2/4:** approve the complete conversion plan. Automatic T6 rule proposal is not implemented.
5. `assets` → `convert` twice → `nav` → local `verify` → **human gate 3/4** → `write --push` (or `publish` in the MCP flow) → `verify --preview` → **human gate 4/4** → `release` (writes the immutable cutover certificate) → `report`.
