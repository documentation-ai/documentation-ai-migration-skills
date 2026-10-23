/**
 * Fern docs (buildwithfern.com).
 *
 * Fern states its navigation in `fern/docs.yml` (and the version and product files it names) and
 * nowhere else: only files those reach are built, so the YAML is the site's structure rather than a
 * description of it. Order is array order, groups are `section:` and `folder:` entries, and a page
 * names its own title and file.
 *
 * Its addresses are derived, and they are what every link into the site uses, so they are derived
 * here exactly as Fern derives them (`DocsDefinitionResolver`, `SlugGenerator` and
 * `buildNavigationForDirectory` in fern-api/fern): each tab, section and page adds lodash's kebabCase
 * of its title unless it states a `slug`; `skip-slug` adds nothing; a page's frontmatter `slug`
 * replaces the whole path below the product or version; a folder's pages are named after their
 * files; versions and products prefix everything under them, and the default version is also served
 * without its prefix. Reading pages at their file paths instead moved every page to an address the
 * site never had, and every internal link and redirect with it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import kebabCase from 'lodash/kebabCase.js';
import { parse as parseYaml } from 'yaml';
import { pageIdFromPlatform } from '../session/ids.js';
import { statedFrontmatter as frontmatter } from './frontmatter.js';
import type { GroupOpenapiRef, SourceNavigationNode, Tree, TreePage } from '../nav/tree.js';
import { readFernApi, platformEndpointPath } from './fern-api.js';
import { sourceRedirects, type SourceRedirects } from './source-redirects.js';

export interface FernRepo {
  root: string;
  /** The site's title (`title:` in docs.yml), which names the migrated site. */
  name?: string;
  tree: Tree;
  /** Pages `docs.yml` names that are not in the repository, and API sections with no spec to build them from. */
  missing: string[];
  /** Files under fern/ that no navigation entry reaches; Fern does not publish them either. */
  unreferenced: string[];
  /** API reference sections: the group each becomes, the spec the platform builds its endpoint pages from, and how many it has. */
  apiSections: Array<GroupOpenapiRef & { title: string; endpoints: number }>;
  /** What of an API section is not carried, said at discovery. */
  apiNotes: string[];
  /** docs.yml `redirects`, then every address Fern served an endpoint at, sent to the page the platform makes for it. */
  redirects: SourceRedirects;
  /** Navigation entries that only link elsewhere (`link:` items, tabs with an `href`): no page to migrate. */
  links: Array<{ title: string; href: string }>;
}

interface FernNavItem {
  page?: string;
  path?: string;
  section?: string;
  contents?: FernNavItem[];
  folder?: string;
  title?: string;
  'title-source'?: string;
  api?: string;
  'api-name'?: string;
  /** An API section's own overview page. */
  summary?: string;
  audiences?: string[];
  link?: string;
  href?: string;
  changelog?: string;
  tab?: string;
  layout?: FernNavItem[];
  variants?: FernVariant[];
  slug?: string;
  'skip-slug'?: boolean;
  hidden?: boolean;
  /** `fa-solid fa-rocket`, a bare name, or a path to an image; read as the source states it. */
  icon?: string;
}

interface FernVariant { title?: string; slug?: string; 'skip-slug'?: boolean; layout?: FernNavItem[]; hidden?: boolean; icon?: string; default?: boolean }
interface FernTab { 'display-name'?: string; slug?: string; 'skip-slug'?: boolean; hidden?: boolean; icon?: string; href?: string; changelog?: string }
interface FernVersion { 'display-name'?: string; path?: string; slug?: string; default?: boolean; hidden?: boolean }
interface FernProduct { 'display-name'?: string; path?: string; slug?: string; href?: string; versions?: FernVersion[]; icon?: string }

/** What a docs.yml, a version file and a product file can each state about navigation. */
interface FernNavigationFile {
  navigation?: FernNavItem[];
  tabs?: Record<string, FernTab>;
  'landing-page'?: FernNavItem;
}

interface FernDocs extends FernNavigationFile {
  title?: string;
  instances?: Array<{ url?: string; 'custom-domain'?: string }>;
  versions?: FernVersion[];
  products?: FernProduct[];
  settings?: { 'folder-title-source'?: string };
  redirects?: unknown;
}

/** Fern's slugjoin: decoded, trimmed parts joined with single slashes, no slash at either end. */
function slugjoin(...parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === 'string')
    .map((part) => { try { return decodeURIComponent(part.trim()); } catch { return part.trim(); } })
    .join('/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

const scopedTo = (slug: string, prefix: string): boolean => prefix.length > 0 && (slug === prefix || slug.startsWith(`${prefix}/`));

/**
 * Fern's SlugGenerator: the address under construction, and the basepath, product and version
 * prefixes it hangs off, so a frontmatter `slug` (written relative to the basepath) replaces only
 * what sits below them.
 */
class FernSlug {
  static root(basepath: string): FernSlug { return new FernSlug(basepath, undefined, undefined, basepath); }
  private constructor(readonly base: string, readonly product: string | undefined, readonly version: string | undefined, readonly path: string) {}

  withProduct(slug: string): FernSlug { const path = slugjoin(this.base, slug); return new FernSlug(this.base, path, this.version, path); }
  withVersion(slug: string): FernSlug { const path = slugjoin(this.product ?? this.base, slug); return new FernSlug(this.base, this.product, path, path); }
  private at(path: string): FernSlug { return new FernSlug(this.base, this.product, this.version, path); }
  private relative(slug: string | undefined): string | undefined { return slug !== undefined && scopedTo(slug, this.base) ? slug.slice(this.base.length + 1) : slug; }

  /** A frontmatter slug: the whole path below the product and version. */
  set(raw: string): FernSlug {
    const slug = slugjoin(raw);
    const product = this.relative(this.product); const version = this.relative(this.version);
    if (this.product !== undefined && this.version !== undefined) {
      if (slug.startsWith(this.product)) return this.at(slugjoin(this.version, slug.slice(this.product.length)));
      if (this.base && slug.startsWith(this.base)) return this.at(slugjoin(this.base, slug.slice(this.base.length)));
      if (version !== undefined && scopedTo(slug, version)) return this.at(slugjoin(this.base, slug));
      if (product !== undefined && scopedTo(slug, product)) return this.at(slugjoin(this.version, slug.slice(product.length)));
      return this.at(slugjoin(this.version, slug));
    }
    if (this.version !== undefined) {
      if (slug.startsWith(this.version)) return this.at(slug);
      if (this.base && slug.startsWith(this.base)) return this.at(slugjoin(this.version, slug.slice(this.base.length)));
      if (version !== undefined && scopedTo(slug, version)) return this.at(slugjoin(this.base, slug));
      return this.at(slugjoin(this.version, slug));
    }
    if (this.product !== undefined) {
      if (slug.startsWith(this.product)) return this.at(slug);
      if (this.base && slug.startsWith(this.base)) return this.at(slugjoin(slug.slice(this.base.length)));
      if (product !== undefined && scopedTo(slug, product)) return this.at(slugjoin(this.base, slug));
      return this.at(slugjoin(this.product, slug));
    }
    if (this.base) return this.at(slug.startsWith(this.base) ? slug : slugjoin(this.base, slug));
    return this.at(slug);
  }

  /** One level down: nothing with skip-slug, the frontmatter slug when the page states one, otherwise the url slug. */
  apply(opts: { urlSlug: string; fullSlug?: string; skip?: boolean }): FernSlug {
    if (opts.skip) return this;
    if (opts.fullSlug !== undefined) return this.set(opts.fullSlug);
    // a slug written at the root of a product or version may restate the scope it already lives under
    const scope = this.version ?? this.product ?? this.base;
    const relativeScope = this.relative(scope) ?? '';
    const url = slugjoin(opts.urlSlug);
    if (this.path === scope && relativeScope && url.startsWith(`${relativeScope}/`)) return this.set(opts.urlSlug);
    return this.at(slugjoin(this.path, opts.urlSlug));
  }
}

/** A folder or file name as Fern makes it a slug: lower case, spaces to dashes, nothing but a-z, 0-9 and dashes. */
const nameToSlug = (name: string): string => name.replace(/\.(md|mdx)$/i, '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
/** A folder or file name as Fern makes it a title: separators to spaces, each word capitalised. */
const nameToTitle = (name: string): string => name.replace(/\.(md|mdx)$/i, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
const isMarkdown = (name: string): boolean => /\.mdx?$/i.test(name);
const isIndex = (file: string): boolean => /\/index\.mdx?$/i.test(file.replace(/\\/g, '/'));

/** The page a changelog entry's filename dates, as Fern reads it (`2024-01-15.mdx`), or undefined for any other file. */
function changelogDate(file: string): Date | undefined {
  const match = /^(\d{1,4})-(\d{1,2})-(\d{1,4})/.exec(basename(file).split('.')[0] ?? '');
  if (!match) return undefined;
  const date = new Date(match[0]);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The instance's basepath: `acme.docs.buildwithfern.com/docs` serves every page under `docs/`. */
function basepathOf(docs: FernDocs): string {
  const instance = docs.instances?.find((entry) => entry['custom-domain']) ?? docs.instances?.[0];
  const address = instance?.['custom-domain'] ?? instance?.url;
  if (!address) return '';
  try { return slugjoin(new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`).pathname); } catch { return ''; }
}

export function readFernRepo(rootIn: string): FernRepo {
  const root = resolve(rootIn);
  const fernDir = join(root, 'fern');
  const configPath = ['docs.yml', 'docs.yaml'].map((name) => join(fernDir, name)).find(existsSync);
  if (!configPath) throw new Error(`no fern/docs.yml under ${root}`);
  const readYaml = <T>(file: string): T => {
    try { return (parseYaml(readFileSync(file, 'utf8')) as T | null) ?? ({} as T); }
    catch (error) { throw new Error(`${relative(root, file)} is not valid YAML: ${(error as Error).message}`); }
  };
  const docs = readYaml<FernDocs>(configPath);
  const folderTitleSource = docs.settings?.['folder-title-source'];

  const pages: TreePage[] = [];
  const byFile = new Map<string, TreePage>();
  const missing: string[] = [];
  const apiSections: FernRepo['apiSections'] = [];
  const apiNotes: string[] = [];
  const endpointRedirects: FernRepo['redirects']['exact'] = [];
  const links: FernRepo['links'] = [];
  const referenced = new Set<string>();
  let order = 0;
  let defaultVersion: string | undefined;

  const statedOf = (file: string): Record<string, string> => frontmatter(readFileSync(file, 'utf8'));
  /** A frontmatter slug names a path below the basepath, never another site. */
  const fullSlugOf = (file: string): string | undefined => {
    const slug = existsSync(file) ? statedOf(file).slug?.trim() : undefined;
    return slug && !/^[a-z][a-z0-9+.-]*:/i.test(slug) ? slug : undefined;
  };

  interface Scope {
    slug: FernSlug;
    group: string[];
    /** Where the YAML that names these entries lives; their paths are relative to it. */
    configDir: string;
    hidden?: boolean;
    version?: string;
    /** The address segment this version is served under (its `slug`), which need not be its display name made a slug. */
    versionPath?: string;
    /** The default version is also served with its prefix taken off. */
    unprefixed?: { from: string; to: string };
  }

  /**
   * One page at one address. A file Fern places twice is one page at two addresses: the first is
   * where it is migrated, the second redirects there.
   */
  const addPage = (file: string, navTitle: string, at: FernSlug, scope: Scope, extra: { hidden?: boolean; icon?: string } = {}): SourceNavigationNode | undefined => {
    if (!file.startsWith(root + '/') || !existsSync(file)) { missing.push(relative(fernDir, file)); return undefined; }
    referenced.add(file);
    const versioned = `/${at.path}`;
    const unprefixed = scope.unprefixed && scopedTo(at.path, scope.unprefixed.from) ? `/${slugjoin(scope.unprefixed.to, at.path.slice(scope.unprefixed.from.length))}` : undefined;
    // the address a reader is shown: the default version's pages are linked without the prefix
    const shown = unprefixed ?? versioned;
    const stated = statedOf(file);
    const label = stated['sidebar-title'] ?? navTitle;
    const icon = typeof extra.icon === 'string' && extra.icon.trim() ? { icon: extra.icon.trim() } : {};
    const hidden = extra.hidden || scope.hidden ? { hidden: true } : {};
    const existing = byFile.get(file);
    if (existing) {
      existing.aliases = [...new Set([...(existing.aliases ?? []), ...[shown, versioned].filter((path) => path !== existing.oldPath)])];
      return { type: 'page', pageId: existing.id, title: label, ...icon, ...hidden };
    }
    const source = relative(root, file);
    const title = stated.title ?? navTitle;
    const page: TreePage = {
      id: pageIdFromPlatform('fern', source),
      title,
      titleSource: 'source-config',
      ...(label !== title ? { sidebarTitle: label } : {}),
      ...(stated.description ? { description: stated.description } : {}),
      source,
      group: scope.group,
      order: order++,
      oldPath: shown === '/' ? '/' : shown.replace(/\/$/, ''),
      ...(unprefixed && unprefixed !== versioned ? { aliases: [versioned] } : {}),
      ...(scope.version ? { version: scope.version } : {}),
      ...(scope.versionPath ? { versionPath: scope.versionPath } : {}),
      migrate: true,
      reason: 'docs.yml',
    };
    pages.push(page); byFile.set(file, page);
    return { type: 'page', pageId: page.id, title: label, ...icon, ...hidden };
  };

  /** A folder's pages and subfolders, ordered as Fern orders them: stated positions first, then titles. */
  const discoverFolder = (dir: string, titleSource: string | undefined): FernNavItem[] => {
    if (!existsSync(dir)) { missing.push(relative(fernDir, dir)); return []; }
    const entries = readdirSync(dir, { withFileTypes: true }).filter((entry) => !entry.isSymbolicLink() && !entry.name.startsWith('_'));
    const byFrontmatter = titleSource === 'frontmatter';
    const items: Array<{ item: FernNavItem; title: string; position?: number }> = [];
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isFile() && isMarkdown(entry.name)) {
        const stated = statedOf(path);
        const title = (byFrontmatter && stated.title) || nameToTitle(entry.name);
        const position = stated.position !== undefined && Number.isFinite(Number(stated.position)) ? Number(stated.position) : undefined;
        items.push({ item: { page: title, path, slug: nameToSlug(entry.name), ...(stated.hidden === 'true' ? { hidden: true } : {}) }, title, position });
      } else if (entry.isDirectory()) {
        const index = ['index.mdx', 'index.md'].map((name) => join(path, name)).find(existsSync);
        const stated = index ? statedOf(index) : {};
        const title = (byFrontmatter && stated.title) || nameToTitle(entry.name);
        const position = stated.position !== undefined && Number.isFinite(Number(stated.position)) ? Number(stated.position) : undefined;
        items.push({ item: { folder: path, title, slug: nameToSlug(entry.name), ...(stated.hidden === 'true' ? { hidden: true } : {}) }, title, position });
      }
    }
    items.sort((a, b) => {
      if ((a.position === undefined) !== (b.position === undefined)) return a.position === undefined ? 1 : -1;
      return (a.position ?? 0) - (b.position ?? 0) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });
    return items.map((entry) => entry.item);
  };

  /** A section: its own page (the overview) at the section's address, its entries below it unless it skips its slug. */
  const section = (title: string, opts: { overview?: string; contents: FernNavItem[]; slug?: string; skip?: boolean; hidden?: boolean; icon?: string }, scope: Scope): SourceNavigationNode | undefined => {
    const urlSlug = opts.slug ?? kebabCase(title);
    const fullSlug = opts.overview ? fullSlugOf(opts.overview) : undefined;
    const own = opts.skip && fullSlug !== undefined ? scope.slug.apply({ urlSlug, fullSlug }) : scope.slug.apply({ urlSlug, fullSlug, skip: opts.skip });
    const below = opts.skip && fullSlug !== undefined ? scope.slug : own;
    const inner: Scope = { ...scope, slug: below, group: [...scope.group, title], hidden: scope.hidden || opts.hidden };
    const overview = opts.overview ? addPage(opts.overview, title, own, inner) : undefined;
    const children = walk(opts.contents, inner);
    if (!children.length && !overview) return undefined;
    // the sidebar shows the overview page's own sidebar title, when it states one, as the section's label
    const label = (opts.overview && existsSync(opts.overview) ? statedOf(opts.overview)['sidebar-title'] : undefined) ?? title;
    return {
      type: 'group', label, children,
      ...(overview?.type === 'page' ? { pageId: overview.pageId } : {}),
      ...(typeof opts.icon === 'string' && opts.icon.trim() ? { icon: opts.icon.trim() } : {}),
      ...(opts.hidden || scope.hidden ? { hidden: true } : {}),
    };
  };

  /** A changelog: an overview page (summary, index or overview) and one page per dated file, at YYYY/M/D below it. */
  const changelog = (folder: string, title: string, slug: string | undefined, scope: Scope, hidden?: boolean): SourceNavigationNode | undefined => {
    const dir = resolve(scope.configDir, folder);
    if (!existsSync(dir)) { missing.push(relative(fernDir, dir)); return undefined; }
    const files = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && isMarkdown(entry.name)).map((entry) => join(dir, entry.name));
    const overview = files.find((file) => !changelogDate(file) && ['summary', 'index', 'overview'].includes(basename(file).split('.')[0]!.toLowerCase()));
    const own = scope.slug.apply({ urlSlug: slug ?? kebabCase(title), fullSlug: overview ? fullSlugOf(overview) : undefined });
    const inner: Scope = { ...scope, group: [...scope.group, title], hidden: scope.hidden || hidden };
    const overviewNode = overview ? addPage(overview, title, own, inner) : undefined;
    const entries = files.flatMap((file) => { const date = changelogDate(file); return date ? [{ file, date }] : []; }).sort((a, b) => b.date.getTime() - a.date.getTime());
    const children = entries.flatMap(({ file, date }) => {
      const at = own.apply({ urlSlug: `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`, fullSlug: fullSlugOf(file) });
      const node = addPage(file, `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`, at, inner);
      return node ? [node] : [];
    });
    if (!children.length && !overviewNode) return undefined;
    return { type: 'group', label: title, children, ...(overviewNode?.type === 'page' ? { pageId: overviewNode.pageId } : {}), ...(hidden || scope.hidden ? { hidden: true } : {}) };
  };

  const walk = (items: readonly FernNavItem[], scope: Scope): SourceNavigationNode[] => {
    const out: SourceNavigationNode[] = [];
    for (const item of items ?? []) {
      if (!item || typeof item !== 'object') continue;
      if (item.api !== undefined) {
        const node = apiSection(item, scope);
        if (node) out.push(node);
        continue;
      }
      if (item.link !== undefined) { if (item.href) links.push({ title: String(item.link), href: item.href }); continue; }
      if (item.changelog !== undefined) {
        const node = changelog(item.changelog, item.title ?? 'Changelog', item.slug, scope, item.hidden);
        if (node) out.push(node);
        continue;
      }
      if (item.page !== undefined && item.path) {
        const file = resolve(scope.configDir, item.path);
        const node = addPage(file, String(item.page), scope.slug.apply({ urlSlug: item.slug ?? kebabCase(String(item.page)), fullSlug: fullSlugOf(file) }), scope, { hidden: item.hidden, icon: item.icon });
        if (node) out.push(node);
        continue;
      }
      if (item.section !== undefined) {
        const node = section(String(item.section), { overview: item.path ? resolve(scope.configDir, item.path) : undefined, contents: item.contents ?? [], slug: item.slug, skip: item['skip-slug'], hidden: item.hidden, icon: item.icon }, scope);
        if (node) out.push(node);
        continue;
      }
      if (item.folder !== undefined) {
        const dir = resolve(scope.configDir, item.folder);
        const titleSource = item['title-source'] ?? folderTitleSource;
        const discovered = discoverFolder(dir, titleSource);
        const index = discovered.find((entry) => entry.path && (entry.slug === 'index' || isIndex(entry.path)));
        const indexTitle = titleSource === 'frontmatter' && index?.path ? statedOf(index.path).title : undefined;
        const title = item.title ?? indexTitle ?? nameToTitle(basename(dir));
        // a folder's entries are named relative to the folder itself, so they carry absolute paths
        const node = section(title, { overview: index?.path, contents: discovered.filter((entry) => entry !== index), slug: item.slug ?? nameToSlug(basename(dir)), skip: item['skip-slug'], hidden: item.hidden, icon: item.icon }, { ...scope, configDir: dir });
        if (node) out.push(node);
      }
    }
    return out;
  };

  /**
   * An API reference section: a group the platform fills with one page per endpoint of its spec,
   * opened by the section's summary page when it has one, with any pages its layout places beside
   * the endpoints. Every address Fern served an endpoint at redirects to the platform's page for it.
   */
  const apiSection = (item: FernNavItem, scope: Scope): SourceNavigationNode | undefined => {
    const title = String(item.api);
    const api = readFernApi(root, fernDir, item);
    apiNotes.push(...api.notes);
    if (!api.spec) { missing.push(`API reference "${title}" (no OpenAPI spec to build it from)`); return undefined; }
    const own = scope.slug.apply({ urlSlug: item.slug ?? kebabCase(title), skip: item['skip-slug'] });
    // Fern hides a section from its sidebar but still serves it; the platform serves endpoint pages only from a navigation group
    const inner: Scope = { ...scope, slug: own, group: [...scope.group, title] };
    const summary = item.summary ? addPage(resolve(scope.configDir, item.summary), title, own, inner) : undefined;
    const children = walk(item.layout ?? [], inner);
    for (const endpoint of api.endpoints) {
      if (endpoint.hidden || !endpoint.slugs.length) continue;
      const at = endpoint.slugs.reduce((slug, level) => slug.apply(level), own).path;
      const unprefixed = scope.unprefixed && scopedTo(at, scope.unprefixed.from) ? slugjoin(scope.unprefixed.to, at.slice(scope.unprefixed.from.length)) : undefined;
      const destination = `/${platformEndpointPath(endpoint.method, endpoint.path)}`;
      for (const source of new Set([unprefixed, at].filter((path): path is string => path !== undefined).map((path) => `/${path}`))) {
        if (source !== destination) endpointRedirects.push({ source, destination, statusCode: 308 });
      }
    }
    const hiddenApis = api.endpoints.filter((endpoint) => endpoint.hidden).map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    apiSections.push({ title, groupPath: inner.group, spec: api.spec, ...(scope.version ? { version: scope.version } : {}), ...(hiddenApis.length ? { hiddenApis } : {}), endpoints: api.endpoints.length - hiddenApis.length });
    return { type: 'group', label: title, children, openapi: true, ...(summary?.type === 'page' ? { pageId: summary.pageId } : {}) };
  };

  /** A navigation file's own landing page, then its tabs or its entries. */
  const navigationOf = (file: FernNavigationFile, scope: Scope): SourceNavigationNode[] => {
    const out: SourceNavigationNode[] = [];
    const landing = file['landing-page'];
    if (landing?.page !== undefined && landing.path) {
      const path = resolve(scope.configDir, landing.path);
      const node = addPage(path, String(landing.page), scope.slug.apply({ urlSlug: landing.slug ?? kebabCase(String(landing.page)), fullSlug: fullSlugOf(path) }), scope, { hidden: landing.hidden, icon: landing.icon });
      if (node) out.push(node);
    }
    const entries = file.navigation ?? [];
    if (!entries.some((entry) => entry && typeof entry === 'object' && entry.tab !== undefined)) return [...out, ...walk(entries, scope)];
    for (const entry of entries) {
      if (entry?.tab === undefined) continue;
      const tab = file.tabs?.[entry.tab] ?? {};
      const title = tab['display-name'] ?? entry.tab;
      const icon = typeof tab.icon === 'string' && tab.icon.trim() ? { icon: tab.icon.trim() } : {};
      if (tab.href && !entry.layout && !entry.variants) { links.push({ title, href: tab.href }); continue; }
      if (tab.changelog && !entry.layout && !entry.variants) {
        const node = changelog(tab.changelog, title, tab.slug, scope, tab.hidden);
        if (node && node.type === 'group') out.push({ ...node, kind: 'tab', ...icon });
        continue;
      }
      const tabSlug = scope.slug.apply({ urlSlug: tab.slug ?? kebabCase(title), skip: tab['skip-slug'] });
      const inner: Scope = { ...scope, slug: tabSlug, group: [...scope.group, title], hidden: scope.hidden || tab.hidden };
      const children = entry.variants
        ? entry.variants.flatMap((variant) => {
          const label = variant.title ?? 'Variant';
          const variantScope: Scope = { ...inner, slug: tabSlug.apply({ urlSlug: variant.slug ?? kebabCase(label), skip: variant['skip-slug'] }), group: [...inner.group, label], hidden: inner.hidden || variant.hidden };
          const nodes = walk(variant.layout ?? [], variantScope);
          return nodes.length ? [{ type: 'group' as const, label, children: nodes, ...(variant.hidden ? { hidden: true } : {}) }] : [];
        })
        : walk(entry.layout ?? [], inner);
      if (children.length) out.push({ type: 'group', kind: 'tab', label: title, children, ...icon, ...(tab.hidden ? { hidden: true } : {}) });
    }
    return out;
  };

  /** Each version from its own file, prefixed by its slug; the default one is linked without the prefix. */
  const versionsOf = (versions: readonly FernVersion[], scope: Scope): SourceNavigationNode[] => {
    const explicit = versions.findIndex((version) => version.default === true);
    const visible = versions.findIndex((version) => version.hidden !== true);
    const defaultIndex = explicit !== -1 ? explicit : visible === -1 ? 0 : visible;
    return versions.flatMap((version, index) => {
      const name = version['display-name'] ?? version.slug ?? `Version ${index + 1}`;
      if (!version.path) return [];
      const file = resolve(fernDir, version.path);
      if (!existsSync(file)) { missing.push(version.path); return []; }
      if (index === defaultIndex && scope.version === undefined) defaultVersion ??= name;
      const slug = scope.slug.withVersion(version.slug ?? kebabCase(name));
      const children = navigationOf(readYaml<FernNavigationFile>(file), {
        ...scope, slug, configDir: dirname(file), version: name, versionPath: slug.path,
        ...(index === defaultIndex ? { unprefixed: { from: slug.path, to: scope.slug.path } } : {}),
      });
      return children.length ? [{ type: 'group' as const, kind: 'version' as const, label: name, children, ...(version.hidden ? { hidden: true } : {}) }] : [];
    });
  };

  const rootScope: Scope = { slug: FernSlug.root(basepathOf(docs)), group: [], configDir: dirname(configPath) };
  const navigation: SourceNavigationNode[] = [];
  if (docs.products?.length) {
    for (const product of docs.products) {
      const name = product['display-name'] ?? product.slug ?? 'Product';
      if (product.href && !product.path) { links.push({ title: name, href: product.href }); continue; }
      const scope: Scope = { ...rootScope, slug: rootScope.slug.withProduct(product.slug ?? kebabCase(name)), group: [name] };
      let children: SourceNavigationNode[] = [];
      if (product.versions?.length) children = versionsOf(product.versions, scope);
      else if (product.path) {
        const file = resolve(fernDir, product.path);
        if (existsSync(file)) children = navigationOf(readYaml<FernNavigationFile>(file), { ...scope, configDir: dirname(file) });
        else missing.push(product.path);
      }
      if (children.length) navigation.push({ type: 'group', kind: 'product', label: name, children, ...(typeof product.icon === 'string' && product.icon.trim() ? { icon: product.icon.trim() } : {}) });
    }
  } else if (docs.versions?.length) {
    // the root landing page is not carried into versions (Fern does not either)
    navigation.push(...versionsOf(docs.versions, rootScope));
  } else {
    navigation.push(...navigationOf(docs, rootScope));
  }

  const unreferenced: string[] = [];
  const scan = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (isMarkdown(entry.name) && !referenced.has(path)) unreferenced.push(relative(root, path));
    }
  };
  scan(fernDir);

  return {
    root,
    ...(typeof docs.title === 'string' && docs.title.trim() ? { name: docs.title.trim() } : {}),
    tree: { scope: 'full', platform: 'fern', pages, navigation, navigationSource: 'source-config', ...(defaultVersion ? { defaultVersion } : {}) },
    missing, unreferenced, apiSections, apiNotes, links,
    redirects: (() => {
      const stated = sourceRedirects(docs.redirects);
      // a rule the site states wins over one derived for an endpoint at the same address, and an
      // address a written page holds stays that page's
      const taken = new Set([...stated.exact, ...stated.wildcard].map((rule) => rule.source));
      for (const page of pages) for (const address of [page.oldPath, ...(page.aliases ?? [])]) if (address) taken.add(address);
      const derived = [...new Map(endpointRedirects.filter((rule) => !taken.has(rule.source)).map((rule) => [rule.source, rule])).values()];
      return { ...stated, exact: [...stated.exact, ...derived] };
    })(),
  };
}
