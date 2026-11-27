/**
 * Redirects read as a graph, not as a list of rules.
 *
 * Each rule can be individually well-formed while the set of them is broken: two rules claiming the
 * same old path, a rule pointing at a path that is itself redirected, a cycle, or a rule whose
 * destination no page was written for. Every one of those is invisible to a per-rule check and
 * obvious to a reader who clicks the old link — they arrive at a loop, an extra hop, or a 404 on
 * the day the domain moves, which is the moment the customer's search traffic is most exposed.
 *
 * Nothing here rewrites the rules. The redirects belong to the customer's URLs, so a problem is
 * reported for a person to resolve rather than silently "fixed" into a different set.
 */
import { applyRedirectDestination, buildSampleAddressForSource, findPagesMatchedByRedirectSource, isRedirectPattern, matchRedirectPath, stripQueryAndAnchor } from '@dai/content-contract';
import { buildSiteRedirectResolver, toComparableRedirectSource, type RedirectRule } from './plan.js';

/**
 * An exact rule beneath a wildcard redirect that sends its path elsewhere is not a problem: the
 * platform tries exact sources before any pattern, and patterns in a fixed order, so it is a
 * deliberate override, not a choice the host makes.
 */
export type RedirectProblemKind = 'conflict' | 'loop' | 'chain' | 'case-collision' | 'missing-target' | 'covers-page' | 'lost-query';

export interface RedirectProblem {
  kind: RedirectProblemKind;
  detail: string;
}

const normalise = (path: string): string => `/${path.replace(/^\/+|\/+$/g, '')}`;
/** How many written pages a `covers-page` problem names before it only counts the rest. */
const MAX_PAGES_NAMED = 3;
/** Hops after which a run of redirects counts as a loop: a reader's browser gives up long before. */
const MAX_REDIRECT_HOPS = 10;
/** The page an on-site destination lands on: its path without a query or anchor, and a `.md` address as its page. */
const toPageRoute = (destination: string): string => normalise(stripQueryAndAnchor(destination).replace(/\.md$/, ''));
/** A destination that leaves the site is somebody else's to resolve. */
const isExternal = (destination: string): boolean => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination) || destination.startsWith('//');

/**
 * Every way this set of rules fails a reader, in the order an operator should fix them.
 *
 * `routes` holds every route the output has a page at, without a leading slash, as
 * `listOutputPageRoutes` gives them, so a destination can be checked against a page that exists.
 */
export function redirectProblems(rules: readonly RedirectRule[], routes: ReadonlySet<string> = new Set()): RedirectProblem[] {
  const problems: RedirectProblem[] = [];
  const patterns = rules.filter((rule) => isRedirectPattern(rule.source));

  // Two rules for one source, compared as the site compares them (so `/old/:slug*` and
  // `/old/:path*` are one): the site runs the first, and the second never fires.
  const bySource = new Map<string, { source: string; isPattern: boolean; firstDestination: string; destinations: Set<string> }>();
  for (const rule of rules) {
    const key = toComparableRedirectSource(rule.source);
    // A destination that leaves the site keeps its own address: normalising it as a path would turn
    // "https://status.example.com" into a route this migration was supposed to have written.
    const destination = isExternal(rule.destination) ? rule.destination : normalise(rule.destination);
    const isPattern = isRedirectPattern(rule.source);
    const entry = bySource.get(key) ?? { source: isPattern ? rule.source : normalise(rule.source), isPattern, firstDestination: destination, destinations: new Set<string>() };
    entry.destinations.add(destination);
    bySource.set(key, entry);
  }
  for (const { source, destinations } of bySource.values()) {
    if (destinations.size > 1) problems.push({ kind: 'conflict', detail: `${source} is redirected to ${[...destinations].sort().join(' and ')}` });
  }

  // Paths that differ only by case: most hosts match a redirect case-insensitively, so one of the
  // two rules is unreachable and which one depends on the host.
  const byLowercase = new Map<string, Set<string>>();
  for (const { source, isPattern } of bySource.values()) {
    if (isPattern) continue;
    const key = source.toLowerCase();
    byLowercase.set(key, (byLowercase.get(key) ?? new Set()).add(source));
  }
  for (const [, sources] of byLowercase) {
    if (sources.size > 1) problems.push({ kind: 'case-collision', detail: `${[...sources].sort().join(' and ')} differ only by case, and a host that matches case-insensitively will run only one of them` });
  }

  // A query or fragment in a rule's source is not matched by the platforms that run these rules,
  // so the rule silently never fires.
  for (const rule of rules) {
    if (/[?#]/.test(rule.source)) problems.push({ kind: 'lost-query', detail: `${rule.source} carries a query or fragment, which a redirect rule does not match` });
  }

  // Each rule followed hop by hop the way the site answers, through every rule in its processing
  // order: a destination that is itself redirected costs readers a hop (a chain), and one that
  // comes back, or never stops, is a loop.
  const resolveSiteRedirect = buildSiteRedirectResolver(rules);
  const describeChain = (addresses: string[]): RedirectProblem => ({ kind: 'chain', detail: `${addresses.join(' → ')}: redirect to the final address instead` });
  const followRedirects = (start: string, firstDestination: string): RedirectProblem | null => {
    const visited = [start];
    let current = firstDestination;
    for (let hop = 1; hop <= MAX_REDIRECT_HOPS; hop += 1) {
      if (isExternal(current)) return hop > 1 ? describeChain([...visited, current]) : null;
      const address = normalise(stripQueryAndAnchor(current));
      if (visited.includes(address)) return { kind: 'loop', detail: `${[...visited, address].join(' → ')} is a redirect loop` };
      visited.push(address);
      const next = resolveSiteRedirect(address);
      if (!next) return hop > 1 ? describeChain(visited) : null;
      current = next.destination;
    }
    return { kind: 'loop', detail: `${visited.slice(0, 3).join(' → ')} → … keeps redirecting past ${MAX_REDIRECT_HOPS} hops, a redirect loop` };
  };
  for (const { source, firstDestination, isPattern } of bySource.values()) {
    if (isPattern) continue;
    const problem = followRedirects(source, firstDestination);
    if (problem) problems.push(problem);
  }
  for (const rule of patterns) {
    const sample = buildSampleAddressForSource(rule.source);
    const params = matchRedirectPath(sample, rule.source);
    if (!params) continue;
    const problem = followRedirects(normalise(sample), applyRedirectDestination(rule.destination, params));
    if (problem) problems.push(problem);
  }

  // A rule that lands nowhere is a 404 with extra steps.
  if (routes.size) {
    const known = new Set([...routes].map((route) => normalise(route)));
    for (const { source, firstDestination, isPattern } of bySource.values()) {
      if (isPattern || isExternal(firstDestination) || isRedirectPattern(firstDestination) || resolveSiteRedirect(firstDestination)) continue;
      if (!known.has(toPageRoute(firstDestination))) problems.push({ kind: 'missing-target', detail: `${source} → ${firstDestination}, which no written page answers` });
    }
  }

  // A pattern matches every address it describes, written pages included, and the site redirects
  // before it serves a page, so readers never reach those pages.
  if (routes.size) {
    for (const rule of patterns) {
      const pagesCovered = findPagesMatchedByRedirectSource(rule.source, routes).map((page) => `/${page}`);
      if (!pagesCovered.length) continue;
      const named = pagesCovered.slice(0, MAX_PAGES_NAMED).join(', ');
      const unnamedCount = pagesCovered.length - MAX_PAGES_NAMED;
      const more = unnamedCount > 0 ? ` and ${unnamedCount} more` : '';
      problems.push({ kind: 'covers-page', detail: `${rule.source} also matches ${pagesCovered.length} written page(s) (${named}${more}), which readers would be redirected away from` });
    }
  }

  return problems;
}
