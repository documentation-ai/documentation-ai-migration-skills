/**
 * Mintlify source-repository adapter: docs.json (or legacy mint.json)
 * navigation, redirects, OpenAPI references, snippets and site metadata.
 *
 * docs.json navigation is one recursive object. Division keys are
 * versions, languages, tabs, anchors, dropdowns, groups and pages; any
 * division may nest any other. Verified against the published schema on
 * 2026-09-09 (see the architecture report, §5).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { navigationMetadata, type NavigationContainerKind, type SourceNavigationNode, type Tree, type TreePage } from '../nav/tree.js';
import { pageIdFromPlatform } from '../session/ids.js';
import { readEditedJson } from '../session/edited-files.js';
import { sourceRedirects, type SourceRedirects } from './source-redirects.js';

export interface MintlifyOpenApiRef { groupPath: string[]; spec: string; version?: string; locale?: string }

export interface MintlifyRepo {
  root: string;
  configFile: 'docs.json' | 'mint.json';
  name?: string;
  colors?: Record<string, string>;
  logo?: unknown;
  favicon?: string;
  tree: Tree;
  redirects: SourceRedirects;
  openapi: MintlifyOpenApiRef[];
  /** Pages listed in navigation whose file does not exist. */
  missing: string[];
}

const DIVISIONS = ['versions', 'languages', 'tabs', 'anchors', 'dropdowns', 'products', 'menus', 'menu', 'groups', 'pages'] as const;

function pageFile(root: string, page: string): string | undefined {
  for (const ext of ['.mdx', '.md']) { const p = join(root, `${page}${ext}`); if (existsSync(p)) return p; }
  return undefined;
}

function labelOf(node: any): string | undefined {
  return node.group ?? node.tab ?? node.anchor ?? node.dropdown ?? node.product ?? node.version ?? node.language ?? node.menu ?? node.item;
}

export function readMintlifyRepo(rootIn: string): MintlifyRepo {
  const root = resolve(rootIn);
  const configFile = existsSync(join(root, 'docs.json')) ? 'docs.json' : existsSync(join(root, 'mint.json')) ? 'mint.json' : undefined;
  if (!configFile) throw new Error(`no docs.json or mint.json under ${root}`);
  const cfg = readEditedJson<Record<string, any>>(join(root, configFile));

  const pages: TreePage[] = [];
  const pageById = new Map<string, TreePage>();
  const openapi: MintlifyOpenApiRef[] = [];
  const missing: string[] = [];
  let order = 0;
  let defaultVersion: string | undefined; let defaultLocale: string | undefined;

  const walk = (node: any, ctx: { group: string[]; version?: string; locale?: string; openapi?: string }): SourceNavigationNode[] => {
    if (typeof node === 'string') {
      const file = pageFile(root, node);
      if (!file) { missing.push(node); return []; }
      const id = pageIdFromPlatform('mintlify', `${ctx.locale ?? ''}|${ctx.version ?? ''}|${node}`);
      let page = pageById.get(id);
      if (!page) {
        page = { id, title: node.split('/').pop()!.replace(/[-_]+/g, ' '), source: file.slice(root.length + 1), group: ctx.group, order: order++, oldPath: `/${node}`, migrate: true, version: ctx.version, locale: ctx.locale, reason: configFile };
        pageById.set(id, page); pages.push(page);
      }
      return [{ type: 'page', pageId: id }];
    }
    if (Array.isArray(node)) return node.flatMap((n) => walk(n, ctx));
    if (!node || typeof node !== 'object') return [];
    const next = { ...ctx };
    if (typeof node.version === 'string') { next.version = node.version; if (node.default === true || defaultVersion === undefined) defaultVersion = node.version; }
    if (typeof node.language === 'string') { next.locale = node.language; if (node.default === true || defaultLocale === undefined) defaultLocale = node.language; }
    const label = labelOf(node);
    if (label && !node.version && !node.language) next.group = [...ctx.group, String(label)];
    if (typeof node.openapi === 'string') { next.openapi = node.openapi; openapi.push({ groupPath: next.group, spec: node.openapi, version: next.version, locale: next.locale }); }
    else if (node.openapi && typeof node.openapi === 'object' && typeof node.openapi.source === 'string') { openapi.push({ groupPath: next.group, spec: node.openapi.source, version: next.version, locale: next.locale }); }
    // A menu's `item` is what the platform calls a dropdown.
    const kind = (['group', 'tab', 'dropdown', 'product', 'version', 'language', 'menu'] as const).find((key) => typeof node[key] === 'string') ?? (typeof node.anchor === 'string' ? 'menu' : typeof node.item === 'string' ? 'dropdown' : undefined);
    // Hidden from the navigation is not unpublished: the pages migrate and are reported as unlisted.
    // The entry keeps the label, kind and place the config gives it, marked hidden, so an operator
    // who later decides unlisted pages are shown gets them where and as the source states.
    const hidden = node.hidden === true ? { hidden: true as const } : {};
    if (typeof node.href === 'string' && !DIVISIONS.some((k) => k in node)) {
      if (!label || !kind) throw new Error(`${configFile}: external navigation entry ${node.href} has no supported container label`);
      return [{ type: 'group', kind, label, ...navigationMetadata(node), ...hidden, children: [] }];
    }
    const children: SourceNavigationNode[] = [];
    for (const k of DIVISIONS) if (k in node) children.push(...walk(node[k], next));
    // `global` anchors and tabs are links Mintlify pins above every sidebar, not places in it: they
    // are carried as the top bar's links (mintlifyBranding), the platform's link shown on every page.
    // Walked into the navigation they sat beside its groups, which no navigation can state.
    if (!label || !children.length) return node.hidden === true ? children.map((child) => ({ ...child, hidden: true as const })) : children;
    return [{ type: 'group', kind: kind as NavigationContainerKind, label: String(label), ...navigationMetadata(node), ...hidden, children }];
  };
  const navigation = walk(cfg.navigation ?? {}, { group: [] });

  // page titles from frontmatter when present
  for (const p of pages) {
    const raw = readFileSync(join(root, p.source), 'utf8');
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) continue;
    const data = parseYaml(match[1]) as Record<string, unknown> | undefined;
    if (typeof data?.title === 'string') p.title = data.title;
    if (typeof data?.sidebarTitle === 'string') p.sidebarTitle = data.sidebarTitle;
    if (typeof data?.description === 'string') p.description = data.description;
    for (const key of ['icon', 'tags', 'badge', 'method', 'mode'] as const) if (typeof data?.[key] === 'string') p[key] = data[key];
    // `iconType` is the Font Awesome style of the page's icon, as on a component (`fa-regular:bell`);
    // Mintlify ignores it on a Lucide or Tabler site.
    const iconType = typeof data?.iconType === 'string' ? data.iconType.trim() : '';
    if (iconType && p.icon && /^[a-z0-9-]+$/i.test(p.icon) && !['lucide', 'tabler'].includes(cfg.icons?.library)) p.icon = `fa-${iconType}:${p.icon}`;
    // `tag` is the pill Mintlify draws beside the sidebar title; the platform calls it a badge.
    if (typeof data?.tag === 'string' && data.tag.trim() && p.badge === undefined) p.badge = data.tag.trim();
  }

  return { root, configFile, name: cfg.name, colors: cfg.colors, logo: cfg.logo, favicon: cfg.favicon, tree: { scope: 'full', platform: 'mintlify', pages, navigation, navigationSource: 'source-config', defaultVersion, defaultLocale }, redirects: sourceRedirects(cfg.redirects), openapi, missing };
}

/** Snippet resolver for Mintlify: imports are absolute from the repo root ("/snippets/x.mdx"). */
export function mintlifySnippetResolver(root: string): (importPath: string) => string | undefined {
  const base = resolve(root);
  return (importPath) => {
    const rel = importPath.replace(/^\/+/, '');
    if (!rel.startsWith('snippets/') || rel.includes('..')) return undefined;
    const p = resolve(base, rel);
    if (!p.startsWith(base + '/') || !existsSync(p)) return undefined;
    const raw = readFileSync(p, 'utf8');
    return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''); // snippet frontmatter never renders
  };
}
