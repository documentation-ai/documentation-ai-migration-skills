/**
 * URL plan (plan/urls.yaml): preserve | restructure | hybrid, per page,
 * with reasons. Generates the redirect maps and the anchor map.
 */
import { stringify as toYaml } from 'yaml';
import { readEditedYaml } from '../session/edited-files.js';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Tree, TreePage } from '../nav/tree.js';
import { pathFromTree } from '../nav/tree.js';
import { PLAN_YAML } from '../session/edited-files.js';
import { legalisePath, headingSlug, slugify, slugifySegment } from './slugger.js';
import { applyRedirectDestination, decodeSegment, findPagesMatchedByRedirectSource, isOnSiteAddress, isRedirectPattern, isSelfLoopingRedirect, isWildcardSegment, matchRedirectPath, sortRedirectsByProcessingOrder, stripQueryAndAnchor } from '@dai/content-contract';
import { listPlatformEndpointPaths } from '../openapi/graph.js';
import { listFilesUnder } from '../session/workspace.js';
import GithubSlugger from 'github-slugger';

export interface UrlPlanPage { id: string; old?: string; new: string; reason: string }
export interface UrlPlan {
  /**
   * Pages whose route the platform's slug rules erase: a title or path written in a script that
   * has no ASCII transliteration comes out empty, and numbering those pages would silently destroy
   * every URL the site had. Listed here so the stage can ask for a route instead of inventing one.
   */
  erased?: Array<{ id: string; source?: string; segments: string[] }>;
  mode: 'preserve' | 'restructure' | 'hybrid';
  scope: 'full' | 'partial';
  preserve: { strip_prefix?: string; case: 'preserve' | 'lower' };
  restructure: { strategy: 'from-nav' };
  /**
   * A link to a page this migration does not write (outside its scope, or excluded): `keep` leaves it as authored,
   * and the unmigrated-links gate fails while the output still points at the source site; `source` points links to
   * pages the source is known to publish at the source site, which must then stay up. Convert lists every such link
   * in report/unmigrated-links.json either way.
   */
  unmigratedLinks?: 'keep' | 'source';
  /**
   * Where a repository source is published (`https://buildwithfern.com`), which `source` sends those links to.
   * A crawled source is its own origin and needs none; a repository states no address a link could be sent to.
   */
  sourceSite?: string;
  pages: UrlPlanPage[];
}

export function defaultUrlPlan(tree: Tree, opts: { mode?: UrlPlan['mode']; stripPrefix?: string; case?: 'preserve' | 'lower' } = {}): UrlPlan {
  const mode = opts.mode ?? 'preserve';
  const pages: UrlPlanPage[] = [];
  const used = new Set<string>();
  const planned: Array<{ id: string; old?: string; candidate: string; reason: string }> = [];
  /** Pages whose route the slug rules erased rather than transliterated; a route cannot be invented for them. */
  const erased: NonNullable<UrlPlan['erased']> = [];
  for (const p of tree.pages.filter((x) => x.migrate)) {
    let candidate: string; let reason: string;
    const old = p.oldPath;
    if (mode !== 'restructure' && old) {
      let stripped = old;
      if (opts.stripPrefix && stripped.startsWith(opts.stripPrefix)) stripped = stripped.slice(opts.stripPrefix.length);
      // The file extension a static site serves under is not part of the page's identity:
      // /guide.htm is the page "guide". Legalising it in place would route the page at
      // "guide-htm", because the dot is not a legal slug character and becomes a dash. An
      // index file names the directory holding it, the way a web server serves that directory.
      const withoutSuffix = stripped.replace(/\/index\.(?:html?|xhtml|php|aspx?|jsp)$/i, '/').replace(/\.(?:html?|xhtml|php|aspx?|jsp)$/i, '');
      const droppedSuffix = withoutSuffix !== stripped;
      stripped = withoutSuffix;
      const leg = legalisePath(stripped, { case: opts.case ?? 'preserve' });
      candidate = leg.path;
      if (leg.erased?.length) erased.push({ id: p.id, source: p.source, segments: leg.erased });
      const adjustments = [droppedSuffix ? 'dropped the source file extension' : undefined, leg.reason].filter(Boolean).join('; ');
      reason = adjustments ? `preserve (adjusted: ${adjustments})` : 'preserve';
    } else {
      candidate = pathFromTree(p); reason = 'restructure:nav';
      // The same erasure happens when a route is built from a title rather than a path.
      const fromTitle = [...p.group.filter((group) => group && group !== '(uncategorised)'), p.title].filter((part) => slugifySegment(part).erased);
      if (fromTitle.length) erased.push({ id: p.id, source: p.source, segments: fromTitle });
    }
    if (!candidate) {
      candidate = 'index';
      reason += '; root route -> index';
    }
    // versions and locales other than the default live under a prefix (documentation.json dimensions route them)
    const prefix = [p.locale && p.locale !== tree.defaultLocale ? slugify(p.locale) : '', p.version && p.version !== tree.defaultVersion ? (p.versionPath ?? slugify(p.version)) : ''].filter(Boolean).join('/');
    if (prefix && !candidate.startsWith(prefix + '/')) { candidate = `${prefix}/${candidate}`; reason += `; ${prefix} prefix`; }
    if (!candidate) { candidate = 'index'; reason += '; root page → index'; }
    planned.push({ id: p.id, old, candidate, reason });
  }
  // A page already at a legal path keeps it; a page whose path had to be adjusted gives way on a collision, so its
  // redirect never runs through another page's old path (/a_b → /a-b while /a-b moved on is a chain).
  const finals = new Map<string, { final: string; reason: string }>();
  for (const settled of [true, false]) {
    for (const entry of planned) {
      if ((entry.reason === 'preserve') !== settled) continue;
      let final = entry.candidate; let n = 2;
      while (used.has(final)) final = `${entry.candidate}-${n++}`;
      used.add(final);
      finals.set(entry.id, { final, reason: final !== entry.candidate ? `${entry.reason}; collision → ${final}` : entry.reason });
    }
  }
  for (const entry of planned) pages.push({ id: entry.id, old: entry.old, new: finals.get(entry.id)!.final, reason: finals.get(entry.id)!.reason });
  return { mode, scope: tree.scope, preserve: { strip_prefix: opts.stripPrefix, case: opts.case ?? 'preserve' }, restructure: { strategy: 'from-nav' }, unmigratedLinks: 'keep', pages, ...(erased.length ? { erased } : {}) };
}

export function writeUrlPlan(workspace: string, plan: UrlPlan): void { writeFileSync(join(workspace, 'plan', 'urls.yaml'), toYaml(plan, PLAN_YAML), { mode: 0o600 }); }
/**
 * An existing plan, plus the default entry for every migrating page it does not name. The
 * operator's entries are never changed; a new page whose default route collides with one of
 * theirs is refused rather than renumbered, because a route is an address the site publishes.
 */
export function extendUrlPlan(existing: UrlPlan, tree: Tree, opts: { mode?: UrlPlan['mode']; stripPrefix?: string; case?: 'preserve' | 'lower' } = {}): UrlPlan {
  const known = new Set(existing.pages.map((page) => page.id));
  const missing = tree.pages.filter((page) => page.migrate && !known.has(page.id));
  if (!missing.length) return existing;
  const defaults = defaultUrlPlan(tree, { ...opts, mode: existing.mode ?? opts.mode });
  const taken = new Map(existing.pages.map((page) => [page.new, page.id]));
  const added: UrlPlanPage[] = [];
  for (const page of defaults.pages) {
    if (known.has(page.id)) continue;
    const holder = taken.get(page.new);
    if (holder !== undefined && holder !== page.id) throw new Error(`page ${page.id} (${page.old ?? 'no source path'}) would take route ${page.new}, which plan/urls.yaml already gives page ${holder}; set its "new" path in plan/urls.yaml and run plan again`);
    added.push(page);
  }
  const erased = [...(existing.erased ?? []), ...(defaults.erased ?? []).filter((page) => !known.has(page.id))];
  return { ...existing, pages: [...existing.pages, ...added], ...(erased.length ? { erased } : {}) };
}

export function readUrlPlan(workspace: string): UrlPlan | undefined {
  const p = join(workspace, 'plan', 'urls.yaml');
  return existsSync(p) ? readEditedYaml<UrlPlan>(p) : undefined;
}

export function applyUrlPlan(tree: Tree, plan: UrlPlan): Tree {
  const byId = new Map(plan.pages.map((p) => [p.id, p]));
  return { ...tree, pages: tree.pages.map((p) => { const u = byId.get(p.id); return u ? { ...p, newPath: u.new, reason: p.migrate ? u.reason : p.reason } : p; }) };
}

export interface RedirectRule { source: string; destination: string; statusCode: number }

/**
 * Exact rules for every page whose old path differs from its new path; wildcard redirect candidates
 * (`/old/:slug*` → `/new/:slug*`) for subtrees that moved without renaming anything inside them,
 * of which `buildSiteRedirects` keeps the ones that send no reader away from a page. The exact
 * rules stay complete, one per page, because the reports and gates read them page by page;
 * `collapseRedirectsForSite` shortens the set that documentation.json carries.
 *
 * `writes` names the pages this migration actually writes. A page that left the scope keeps its
 * entry in the plan — plans are the operator's file and a stage never edits one — but it has no
 * destination to send a reader to, so it gets no rule. Without this a page excluded after planning
 * left a redirect pointing at a route nobody wrote.
 */
export function redirectMaps(plan: UrlPlan, writes?: (pageId: string) => boolean): { exact: RedirectRule[]; wildcard: RedirectRule[]; issues: string[] } {
  const exact: RedirectRule[] = [];
  const issues: string[] = [];
  const norm = (p: string) => '/' + p.replace(/^\/+|\/+$/g, '');
  for (const p of plan.pages) {
    if (!p.old) continue;
    if (writes && !writes(p.id)) continue;
    const from = norm(p.old); const to = norm(p.new);
    if (from === to) continue;
    exact.push({ source: from, destination: to, statusCode: 308 });
  }
  // uniqueness, loops, chains
  const bySource = new Map<string, RedirectRule>();
  for (const r of exact) {
    if (bySource.has(r.source)) issues.push(`duplicate source ${r.source}`);
    bySource.set(r.source, r);
  }
  for (const r of exact) {
    if (bySource.has(r.destination)) issues.push(`chain: ${r.source} → ${r.destination} → ${bySource.get(r.destination)!.destination}`);
    if (r.destination === r.source) issues.push(`loop: ${r.source}`);
  }
  // An old path the platform would read as a pattern (`:` starting a segment, or a `*`) matches
  // more addresses than the one page it stands for.
  for (const r of exact) if (isRedirectPattern(r.source)) issues.push(`old path ${r.source} reads as a redirect pattern, so it would match more than its own page`);
  // Subtree wildcard redirects: an old prefix → new prefix shared by ≥ 3 pages, written as one rule
  // that also covers the subtree's addresses nobody crawled. A wildcard copies what it matched
  // verbatim, so it only says the same thing as the rules it covers where the part after the
  // prefix survives unchanged. Where the filenames change too — preserve mode slugifies them, so
  // `p_a_Step1.htm` becomes `p-a-step1` — no single wildcard expresses the move, and writing one
  // would send every path it covers to a page nobody wrote. Those subtrees keep their exact rules.
  const prefixPairs = new Map<string, { covered: number; splatSurvives: boolean }>();
  for (const r of exact) {
    const o = r.source.split('/').slice(0, -1).join('/'); const n = r.destination.split('/').slice(0, -1).join('/');
    if (!o || !n || o === n) continue;
    const key = `${o}|${n}`;
    const entry = prefixPairs.get(key) ?? { covered: 0, splatSurvives: true };
    entry.covered++;
    if (r.source.slice(o.length + 1) !== r.destination.slice(n.length + 1)) entry.splatSurvives = false;
    prefixPairs.set(key, entry);
  }
  // …and only where every exact rule anywhere beneath the old prefix agrees: `/docs/:slug*` →
  // `/en/docs/:slug*` is wrong for `/docs/documentation/fr/…`, which moves to `/fr/docs/…`, and a
  // wildcard redirect that covers those would send them to a page nobody wrote.
  const agreesBeneath = (o: string, n: string): boolean => exact.every((r) => !r.source.startsWith(`${o}/`) || r.destination === `${n}${r.source.slice(o.length)}`);
  const buildSubtreeRule = (o: string, n: string): RedirectRule => ({ source: `${o}/:slug*`, destination: `${n}/:slug*`, statusCode: 308 });
  const wildcard = [...prefixPairs.entries()]
    .map(([k, entry]) => { const [o, n] = k.split('|'); return { o, n, entry }; })
    .filter(({ o, n, entry }) => entry.covered >= 3 && entry.splatSurvives && agreesBeneath(o, n))
    .map(({ o, n }) => buildSubtreeRule(o, n))
    // a destination inside its own source (`/docs` → `/docs/en`) redirects readers forever
    .filter((rule) => !isSelfLoopingRedirect(rule));
  return { exact, wildcard, issues };
}

/**
 * One form for sources the site treats as the same: parameter and wildcard names replaced by one
 * placeholder, edge slashes dropped and plain segments decoded, as the site compares them. So
 * `/old/:slug*` and `/old/:path*` (with or without a trailing slash) are one source, and only the first of them ever runs.
 */
export function toComparableRedirectSource(source: string): string {
  const segments = source.split('/').filter(Boolean).map((segment) => {
    if (isWildcardSegment(segment)) return ':*';
    if (segment.startsWith(':')) return ':';
    return decodeSegment(segment);
  });
  return `/${segments.join('/')}`;
}

const MARKDOWN_SUFFIX = '.md';
const isMarkdownSource = (source: string): boolean => source.endsWith(MARKDOWN_SUFFIX);
const toComparablePath = (path: string): string => path.replace(/\/+$/, '') || '/';

/** The first rule for each source, in list order: the site runs that one, and a later one never fires. */
const keepFirstRulePerSource = (rules: readonly RedirectRule[]): RedirectRule[] => {
  const sources = new Set<string>();
  return rules.filter((rule) => {
    const source = toComparableRedirectSource(rule.source);
    if (sources.has(source)) return false;
    sources.add(source);
    return true;
  });
};

export interface SiteRedirectAnswer { destination: string; statusCode: number }

/**
 * Where the site sends one address, as its middleware decides: page addresses through the rules
 * whose source is not a `.md` address, in processing order; a `.md` address through the `.md` rules
 * first, then its page's rule with `.md` on the destination. Exact sources are looked up, so the
 * resolver is cheap to call for every rule of a large site.
 */
export function buildSiteRedirectResolver(rules: readonly RedirectRule[]): (address: string) => SiteRedirectAnswer | null {
  const firstRules = keepFirstRulePerSource(rules);
  const buildFinder = (subset: RedirectRule[]) => {
    const exactBySource = new Map(subset.filter((rule) => !isRedirectPattern(rule.source)).map((rule) => [toComparableRedirectSource(rule.source), rule]));
    const patterns = sortRedirectsByProcessingOrder(subset.filter((rule) => isRedirectPattern(rule.source)));
    return (path: string): SiteRedirectAnswer | null => {
      const exact = exactBySource.get(toComparableRedirectSource(path));
      if (exact) return { destination: exact.destination, statusCode: exact.statusCode };
      for (const pattern of patterns) {
        const params = matchRedirectPath(path, pattern.source);
        if (params) return { destination: applyRedirectDestination(pattern.destination, params), statusCode: pattern.statusCode };
      }
      return null;
    };
  };
  const findPageRedirect = buildFinder(firstRules.filter((rule) => !isMarkdownSource(rule.source)));
  const findMarkdownRedirect = buildFinder(firstRules.filter((rule) => isMarkdownSource(rule.source)));
  const appendMarkdownSuffix = (answer: SiteRedirectAnswer | null): SiteRedirectAnswer | null => {
    if (!answer || !answer.destination.startsWith('/')) return answer;
    const destinationPath = stripQueryAndAnchor(answer.destination);
    const page = destinationPath.replace(/\/+$/, '');
    if (!page) return answer;
    return { ...answer, destination: `${page}${MARKDOWN_SUFFIX}${answer.destination.slice(destinationPath.length)}` };
  };
  return (address) => {
    const path = stripQueryAndAnchor(address);
    if (!isMarkdownSource(path)) return findPageRedirect(path);
    return findMarkdownRedirect(path) ?? appendMarkdownSuffix(findPageRedirect(path.slice(0, -MARKDOWN_SUFFIX.length) || '/'));
  };
}

const isSameAnswer = (answer: SiteRedirectAnswer | null, rule: RedirectRule): boolean =>
  answer !== null && toComparablePath(answer.destination) === toComparablePath(rule.destination) && answer.statusCode === rule.statusCode;

/**
 * The redirects documentation.json carries: the first rule for each source, less each exact rule a
 * pattern already says. The site tries exact sources first, so dropping one hands its address to the
 * patterns; a page rule is dropped only when the first page pattern the site would then try sends
 * the address to the same destination with the same status, and never for a `.md` pattern, which
 * applies to Markdown addresses only. Every dropped rule is then resolved through the final list
 * and kept after all if the answer changed, so readers see exactly what they would have.
 */
export function collapseRedirectsForSite(rules: readonly RedirectRule[]): RedirectRule[] {
  const firstRules = keepFirstRulePerSource(rules);
  const resolveThroughPagePatterns = buildSiteRedirectResolver(firstRules.filter((rule) => isRedirectPattern(rule.source) && !isMarkdownSource(rule.source)));
  const dropped = new Set(firstRules.filter((rule) => !isRedirectPattern(rule.source) && !isMarkdownSource(rule.source) && isSameAnswer(resolveThroughPagePatterns(rule.source), rule)));
  const collapsed = firstRules.filter((rule) => !dropped.has(rule));
  const resolveThroughFinalList = buildSiteRedirectResolver(collapsed);
  const changedAnswers = new Set([...dropped].filter((rule) => !isSameAnswer(resolveThroughFinalList(rule.source), rule)));
  return firstRules.filter((rule) => !dropped.has(rule) || changedAnswers.has(rule));
}

const PAGE_FILE = /\.mdx?$/;
const SUBTREE_WILDCARD = '/:slug*';

/** The specs a navigation's groups connect (`openapi` on a group naming a file), with the operations each hides. */
const listNavigationOpenapiGroups = (navigation: unknown): Array<{ spec: string; hiddenApis: string[] }> => {
  if (Array.isArray(navigation)) return navigation.flatMap(listNavigationOpenapiGroups);
  if (!navigation || typeof navigation !== 'object') return [];
  const node = navigation as Record<string, unknown>;
  const nested = Object.values(node).flatMap(listNavigationOpenapiGroups);
  const isSpecFileGroup = typeof node.group === 'string' && typeof node.openapi === 'string' && !/^https?:\/\//i.test(node.openapi);
  if (!isSpecFileGroup) return nested;
  const hiddenApis = Array.isArray(node['hidden-apis']) ? node['hidden-apis'].filter((entry): entry is string => typeof entry === 'string') : [];
  return [{ spec: (node.openapi as string).replace(/^\/+/, ''), hiddenApis }, ...nested];
};

/**
 * Every route the output holds a page for, without a leading slash. Unlike `servedRoutes`, which
 * reads only the routes documentation.json's navigation names, this is every page whether or not
 * the navigation names it: each page file (written, unlisted, section index and hub pages alike;
 * an `index` page also at its folder's address) and each page the platform builds for a spec a
 * navigation group connects, less the operations the group hides, as its deployment step builds
 * them. Worked out once per nav stage.
 */
export function listOutputPageRoutes(outputDir: string, navigation: unknown): Set<string> {
  const routes = new Set<string>();
  for (const file of listFilesUnder(outputDir)) {
    const outputPath = relative(outputDir, file).split('\\').join('/');
    if (!PAGE_FILE.test(outputPath)) continue;
    const page = outputPath.replace(PAGE_FILE, '');
    routes.add(page);
    if (/(^|\/)index$/.test(page)) routes.add(page.replace(/\/?index$/, ''));
  }
  for (const { spec, hiddenApis } of listNavigationOpenapiGroups(navigation)) {
    const specFile = join(outputDir, spec);
    if (!existsSync(specFile)) continue;
    for (const route of listPlatformEndpointPaths(readFileSync(specFile, 'utf8'), spec, hiddenApis)) routes.add(route);
  }
  return routes;
}

export interface SiteRedirects {
  /** One exact rule per page whose address changed, from the URL plan. */
  movedPages: RedirectRule[];
  /** Wildcard redirects for subtrees that moved whole. */
  subtrees: RedirectRule[];
  /** The source site's own redirects, less those an address in the plan already claims. */
  carried: RedirectRule[];
  issues: string[];
  /** The rules for one address each: the moved pages', then the source's. */
  exact: RedirectRule[];
  /** The dynamic redirects (a parameter, a wildcard or a partial wildcard): the subtrees', then the source's. */
  dynamic: RedirectRule[];
  /** Every rule documentation.json gets before `collapseRedirectsForSite`, in the site's list order. */
  rules: RedirectRule[];
}

const getSubtreePrefix = (rule: RedirectRule): string => rule.source.slice(0, -SUBTREE_WILDCARD.length);

/**
 * The redirects a run gives the site: the plan's rules for moved pages, its wildcard redirects for
 * moved subtrees that send no reader away from a page, then the source's own rules for every source
 * the plan does not already claim (compared in one form, so `:slug*` and `:path*` are one source).
 * A source's rule that points at a page the plan moved goes straight to the page's new address.
 */
export function buildSiteRedirects(input: { plan: UrlPlan; writes: (pageId: string) => boolean; stated?: { exact: RedirectRule[]; dynamic: RedirectRule[] }; outputPageRoutes: ReadonlySet<string> }): SiteRedirects {
  const planRedirects = redirectMaps(input.plan, input.writes);
  // A wildcard matches every address under its prefix, the prefix itself included, so it would send
  // readers away from a page there: one this plan writes, or any other page the output holds. The
  // graph's `covers-page` check asks the same question the same way.
  const pagePaths = new Set([...input.plan.pages.filter((p) => input.writes(p.id)).map((p) => p.new.replace(/^\/+|\/+$/g, '')), ...input.outputPageRoutes]);
  const safeSubtrees = planRedirects.wildcard.filter((rule) => !findPagesMatchedByRedirectSource(rule.source, pagePaths).length);
  // A subtree inside another kept one is already said by it: agreesBeneath holds for every rule
  // under the outer prefix, the inner subtree's included.
  const isInsideAnotherSubtree = (rule: RedirectRule): boolean => safeSubtrees.some((outer) => getSubtreePrefix(rule).startsWith(`${getSubtreePrefix(outer)}/`));
  const subtrees = safeSubtrees.filter((rule) => !isInsideAnotherSubtree(rule));

  // Readers of a source's rule that points at a moved page would otherwise take two hops.
  const resolveMovedPage = buildSiteRedirectResolver(planRedirects.exact);
  const sendToFinalAddress = (rule: RedirectRule): RedirectRule => {
    if (!isOnSiteAddress(rule.destination) || isRedirectPattern(rule.destination)) return rule;
    const destinationPath = stripQueryAndAnchor(rule.destination);
    const movedPage = resolveMovedPage(destinationPath);
    return movedPage ? { ...rule, destination: `${movedPage.destination}${rule.destination.slice(destinationPath.length)}` } : rule;
  };
  const claimed = new Set([...planRedirects.exact, ...subtrees].map((rule) => toComparableRedirectSource(rule.source)));
  const isUnclaimed = (rule: RedirectRule): boolean => !claimed.has(toComparableRedirectSource(rule.source));
  const carriedExact = (input.stated?.exact ?? []).filter(isUnclaimed).map(sendToFinalAddress);
  const carriedDynamic = (input.stated?.dynamic ?? []).filter(isUnclaimed).map(sendToFinalAddress);
  const exact = [...planRedirects.exact, ...carriedExact];
  const dynamic = [...subtrees, ...carriedDynamic];
  return {
    movedPages: planRedirects.exact,
    subtrees,
    carried: [...carriedExact, ...carriedDynamic],
    issues: planRedirects.issues,
    exact,
    dynamic,
    rules: [...exact, ...dynamic],
  };
}

export interface AnchorEntry { pageId: string; headingText: string; oldId?: string; newId: string; needsShim: boolean; inboundLinks: number }

/** Compare source heading ids with the renderer's slugs; shim where an inbound link targets a differing id. */
export function anchorMap(pages: Array<{ pageId: string; headings: Array<{ id: string; text: string; sourceId?: string; aliases?: string[]; component?: boolean }>; titleAnchor?: string }>, inbound: Map<string, number>): { entries: AnchorEntry[]; shims: Map<string, Map<string, string[]>>; leading: Map<string, string> } {
  const entries: AnchorEntry[] = [];
  const shims = new Map<string, Map<string, string[]>>();
  /** pageId → the anchor its title heading published, for pages something still links to by it. */
  const leading = new Map<string, string>();
  for (const p of pages) {
    // The title heading became the frontmatter title, so its anchor has no heading left to sit
    // before. It is written at the head of the body instead, and only where a link still uses it.
    if (p.titleAnchor && (inbound.get(`${p.pageId}#${p.titleAnchor}`) ?? inbound.get(`#${p.titleAnchor}`) ?? 0) > 0) leading.set(p.pageId, p.titleAnchor);
    const slugger = new GithubSlugger();
    for (const h of p.headings) {
      // A component's anchor is not a heading: the renderer gives it no id of its own to compare with.
      const newId = h.component ? '' : headingSlug(h.text, slugger);
      // The source may have published one heading under more than one address - a translated page
      // carries the original's anchor beside its own - and a link may use any of them. Every
      // spelling something points at is kept, not just the first: keeping only one left the pages
      // that link by the other spelling landing nowhere.
      const candidates = [h.sourceId, ...(h.aliases ?? [])].filter((id): id is string => !!id);
      const linksTo = (id: string): number => inbound.get(`${p.pageId}#${id}`) ?? inbound.get(`#${id}`) ?? 0;
      const linked = candidates.filter((id) => linksTo(id) > 0);
      const shimmed = [...new Set(linked.filter((id) => id !== newId))];
      const links = linked.reduce((total, id) => total + linksTo(id), 0);
      entries.push({ pageId: p.pageId, headingText: h.text, oldId: linked[0] ?? h.sourceId, newId, needsShim: shimmed.length > 0, inboundLinks: links });
      if (shimmed.length) { if (!shims.has(p.pageId)) shims.set(p.pageId, new Map()); shims.get(p.pageId)!.set(h.id, shimmed); }
    }
  }
  return { entries, shims, leading };
}
