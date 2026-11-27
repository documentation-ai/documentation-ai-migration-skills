/**
 * A wildcard redirect copies everything after the prefix unchanged. It can therefore only stand in
 * for exact rules that move a subtree without renaming anything inside it. Preserve mode slugifies
 * filenames as well as directories, so on a real Flare site every such wildcard would have sent the
 * paths it covers to files nobody wrote.
 *
 * The platform runs wildcard redirects (`/old/:slug*` → `/new/:slug*`), so they are written into
 * documentation.json; `collapseRedirectsForSite` leaves out the exact rules they already say.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSiteRedirectResolver, buildSiteRedirects, collapseRedirectsForSite, listOutputPageRoutes, redirectMaps, toComparableRedirectSource, type RedirectRule } from '../src/urls/plan.js';
import { redirectProblems } from '../src/urls/redirect-graph.js';
import type { UrlPlan } from '../src/urls/plan.js';

const plan = (pages: Array<[string | undefined, string]>): UrlPlan => ({
  mode: 'preserve', scope: 'full', preserve: { case: 'preserve' }, restructure: { strategy: 'from-nav' },
  pages: pages.map(([old, next], index) => ({ id: `p${index}`, old, new: next, reason: 'test' })),
} as unknown as UrlPlan);

const rule = (source: string, destination: string, statusCode = 308): RedirectRule => ({ source, destination, statusCode });

describe('subtree wildcard redirects', () => {
  it('writes a wildcard redirect in the platform syntax when only the directory moves', () => {
    const { exact, wildcard } = redirectMaps(plan([
      ['/old/a', '/new/a'], ['/old/b', '/new/b'], ['/old/c', '/new/c'],
    ]));
    expect(exact).toHaveLength(3);
    expect(wildcard).toEqual([rule('/old/:slug*', '/new/:slug*')]);
  });

  it('writes none when the filenames change too, because no wildcard reproduces them', () => {
    const { exact, wildcard } = redirectMaps(plan([
      ['/Procedures/Create/p_a_Step1.htm', '/procedures/create/p-a-step1'],
      ['/Procedures/Create/p_a_Step2.htm', '/procedures/create/p-a-step2'],
      ['/Procedures/Create/p_a_Step3.htm', '/procedures/create/p-a-step3'],
    ]));
    expect(exact).toHaveLength(3);
    expect(wildcard).toEqual([]);
  });

  it('writes none whose destination sits inside its source, which would redirect readers forever', () => {
    const { wildcard } = redirectMaps(plan([
      ['/docs/a', '/docs/en/a'], ['/docs/b', '/docs/en/b'], ['/docs/c', '/docs/en/c'],
    ]));
    expect(wildcard).toEqual([]);
  });

  it('offers a candidate for each subtree that moved whole, inner ones included', () => {
    const { wildcard } = redirectMaps(plan([
      ['/old/a', '/new/a'], ['/old/b', '/new/b'], ['/old/c', '/new/c'],
      ['/old/x/a', '/new/x/a'], ['/old/x/b', '/new/x/b'], ['/old/x/c', '/new/x/c'],
    ]));
    expect(wildcard).toEqual([rule('/old/:slug*', '/new/:slug*'), rule('/old/x/:slug*', '/new/x/:slug*')]);
  });

  it('leaves the rule graph clean for exact rules alone', () => {
    const { exact, wildcard } = redirectMaps(plan([
      ['/Procedures/Create/p_a_Step1.htm', '/procedures/create/p-a-step1'],
      ['/Procedures/Create/p_a_Step2.htm', '/procedures/create/p-a-step2'],
      ['/Procedures/Create/p_a_Step3.htm', '/procedures/create/p-a-step3'],
    ]));
    const routes = new Set(exact.map((r) => r.destination.replace(/^\//, '')));
    expect(redirectProblems([...exact, ...wildcard], routes)).toEqual([]);
  });

  it('leaves the rule graph clean for a wildcard redirect and the exact rules it agrees with', () => {
    const { exact, wildcard } = redirectMaps(plan([
      ['/old/a', '/new/a'], ['/old/b', '/new/b'], ['/old/c', '/new/c'],
    ]));
    expect(redirectProblems([...exact, ...wildcard], new Set(['new/a', 'new/b', 'new/c']))).toEqual([]);
  });
});

describe('listOutputPageRoutes', () => {
  const output = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'dai-routes-'));
    mkdirSync(join(dir, 'guides'), { recursive: true }); mkdirSync(join(dir, 'api-reference', 'v2'), { recursive: true });
    writeFileSync(join(dir, 'guides', 'index.mdx'), '# Guides');
    writeFileSync(join(dir, 'guides', 'install.mdx'), '# Install');
    writeFileSync(join(dir, 'api-reference', 'openapi.json'), `\uFEFF${JSON.stringify({ openapi: '3.0.0', paths: { '/users/{id}': { get: {}, delete: {}, trace: {}, parameters: [] }, '/internal': { get: {} } } })}`);
    writeFileSync(join(dir, 'api-reference', 'v2', 'openapi.yaml'), 'openapi: 3.0.0\npaths:\n  /orders:\n    post: {}\n');
    writeFileSync(join(dir, 'api-reference', 'unused.json'), JSON.stringify({ openapi: '3.0.0', paths: { '/never': { get: {} } } }));
    return dir;
  };
  const navigation = {
    tabs: [{ tab: 'API', groups: [
      { group: 'Users', openapi: 'api-reference/openapi.json', 'hidden-apis': ['GET /internal'] },
      { group: 'Orders', pages: [{ group: 'v2', openapi: '/api-reference/v2/openapi.yaml' }] },
      { group: 'Remote', openapi: 'https://api.example.com/openapi.json' },
    ] }],
  };

  it('lists every page file, an index page also at its folder', () => {
    const routes = listOutputPageRoutes(output(), navigation);
    expect(routes).toContain('guides/install');
    expect(routes).toContain('guides/index');
    expect(routes).toContain('guides');
  });

  it('lists the pages the platform builds for each operation of a spec a group connects, beside the spec', () => {
    const routes = listOutputPageRoutes(output(), navigation);
    expect(routes).toContain('api-reference/get-users-id');
    expect(routes).toContain('api-reference/delete-users-id');
    expect(routes).toContain('api-reference/v2/post-orders');
    // no page for TRACE, an operation the group hides, `parameters`, or a spec no group connects
    expect([...routes].filter((route) => route.startsWith('api-reference/'))).toHaveLength(3);
  });

  it('reads a JSON spec that starts with a byte order mark', () => {
    expect(listOutputPageRoutes(output(), navigation)).toContain('api-reference/get-users-id');
  });

  it('returns nothing for an output that does not exist yet', () => {
    expect(listOutputPageRoutes(join(tmpdir(), 'dai-no-such-output'), navigation)).toEqual(new Set());
  });
});

describe('toComparableRedirectSource', () => {
  it('treats parameter and wildcard names, edge slashes and encoding as the site does', () => {
    expect(toComparableRedirectSource('/old/:slug*')).toBe(toComparableRedirectSource('/old/:path*/'));
    expect(toComparableRedirectSource('/docs/:slug')).toBe(toComparableRedirectSource('docs/:page'));
    expect(toComparableRedirectSource('/caf%C3%A9')).toBe(toComparableRedirectSource('/café'));
  });

  it('keeps a parameter, a wildcard and literal text apart', () => {
    expect(toComparableRedirectSource('/old/:slug')).not.toBe(toComparableRedirectSource('/old/:slug*'));
    expect(toComparableRedirectSource('/old/a-*')).not.toBe(toComparableRedirectSource('/old/b-*'));
  });
});

describe('buildSiteRedirectResolver', () => {
  it('tries exact sources first, then patterns in processing order', () => {
    const resolve = buildSiteRedirectResolver([rule('/old/:slug*', '/new/:slug*'), rule('/old/a', '/renamed/a', 301), rule('/old/b-*', '/b-pages')]);
    expect(resolve('/old/a')).toEqual({ destination: '/renamed/a', statusCode: 301 });
    expect(resolve('/old/b-1')).toEqual({ destination: '/b-pages', statusCode: 308 });
    expect(resolve('/old/c/d')).toEqual({ destination: '/new/c/d', statusCode: 308 });
    expect(resolve('/elsewhere')).toBeNull();
  });

  it('runs the first of two rules for one source', () => {
    expect(buildSiteRedirectResolver([rule('/a', '/first'), rule('/a/', '/second')])('/a')).toEqual({ destination: '/first', statusCode: 308 });
  });

  it('never applies a .md rule to a page, and sends a .md address through its page rule', () => {
    const resolve = buildSiteRedirectResolver([rule('/old/:slug.md', '/md/:slug.md'), rule('/old/:slug*', '/new/:slug*')]);
    expect(resolve('/old/a')).toEqual({ destination: '/new/a', statusCode: 308 });
    expect(resolve('/old/a.md')).toEqual({ destination: '/md/a.md', statusCode: 308 });
    expect(buildSiteRedirectResolver([rule('/old/:slug*', '/new/:slug*')])('/old/a.md')).toEqual({ destination: '/new/a.md', statusCode: 308 });
  });
});

describe('buildSiteRedirects', () => {
  const moves = plan([['/old/a', '/new/a'], ['/old/b', '/new/b'], ['/old/c', '/new/c'], ['/x', '/y']]);
  const writes = (): boolean => true;

  it("adds the source's own rules after the plan's, keeping them apart", () => {
    const redirects = buildSiteRedirects({ plan: moves, writes, stated: { exact: [rule('/legacy', '/y')], dynamic: [rule('/beta/:slug*', '/v2/:slug*')] }, outputPageRoutes: new Set() });
    expect(redirects.movedPages).toHaveLength(4);
    expect(redirects.subtrees).toEqual([rule('/old/:slug*', '/new/:slug*')]);
    expect(redirects.carried).toEqual([rule('/legacy', '/y'), rule('/beta/:slug*', '/v2/:slug*')]);
    expect(redirects.rules.map((r) => r.source)).toEqual(['/old/a', '/old/b', '/old/c', '/x', '/legacy', '/old/:slug*', '/beta/:slug*']);
    expect(redirects.exact.map((r) => r.source)).toEqual(['/old/a', '/old/b', '/old/c', '/x', '/legacy']);
    expect(redirects.dynamic.map((r) => r.source)).toEqual(['/old/:slug*', '/beta/:slug*']);
  });

  it("leaves out a source's rule for a source the plan already claims, in any spelling", () => {
    const redirects = buildSiteRedirects({ plan: moves, writes, stated: { exact: [rule('/x/', '/elsewhere')], dynamic: [rule('/old/:path*', '/archive/:path*')] }, outputPageRoutes: new Set() });
    expect(redirects.carried).toEqual([]);
  });

  it('writes no wildcard over a route the site serves, such as an API reference page', () => {
    expect(buildSiteRedirects({ plan: moves, writes, outputPageRoutes: new Set(['old/kept']) }).subtrees).toEqual([]);
    const apiMoves = plan([['/api-reference/a', '/reference/a'], ['/api-reference/b', '/reference/b'], ['/api-reference/c', '/reference/c']]);
    expect(buildSiteRedirects({ plan: apiMoves, writes, outputPageRoutes: new Set() }).subtrees).toEqual([rule('/api-reference/:slug*', '/reference/:slug*')]);
    expect(buildSiteRedirects({ plan: apiMoves, writes, outputPageRoutes: new Set(['api-reference/get-users']) }).subtrees).toEqual([]);
  });

  it('writes no wildcard over a page the plan itself still writes there', () => {
    const kept = plan([['/old/a', '/new/a'], ['/old/b', '/new/b'], ['/old/c', '/new/c'], [undefined, '/old/kept']]);
    expect(buildSiteRedirects({ plan: kept, writes, outputPageRoutes: new Set() }).subtrees).toEqual([]);
  });

  it('writes one rule for a subtree, and the inner one when the outer is not safe', () => {
    const nested = plan([
      ['/old/a', '/new/a'], ['/old/b', '/new/b'], ['/old/c', '/new/c'],
      ['/old/x/a', '/new/x/a'], ['/old/x/b', '/new/x/b'], ['/old/x/c', '/new/x/c'],
    ]);
    expect(buildSiteRedirects({ plan: nested, writes, outputPageRoutes: new Set() }).subtrees).toEqual([rule('/old/:slug*', '/new/:slug*')]);
    expect(buildSiteRedirects({ plan: nested, writes, outputPageRoutes: new Set(['old/kept']) }).subtrees).toEqual([rule('/old/x/:slug*', '/new/x/:slug*')]);
  });

  it("sends a source's rule that points at a moved page straight to its new address, query and anchor kept", () => {
    const redirects = buildSiteRedirects({ plan: plan([['/Guides/Setup', '/guides/setup']]), writes, stated: { exact: [rule('/legacy', '/Guides/Setup#install'), rule('/elsewhere', 'https://example.com/Guides/Setup')], dynamic: [rule('/beta/:slug', '/Guides/Setup?from=:slug')] }, outputPageRoutes: new Set() });
    expect(redirects.carried).toEqual([rule('/legacy', '/guides/setup#install'), rule('/elsewhere', 'https://example.com/Guides/Setup'), rule('/beta/:slug', '/guides/setup?from=:slug')]);
  });

  it("puts a source's parameter rule with the dynamic redirects", () => {
    const redirects = buildSiteRedirects({ plan: plan([]), writes, stated: { exact: [rule('/old', '/new')], dynamic: [rule('/docs/:slug', '/guides/:slug')] }, outputPageRoutes: new Set() });
    expect(redirects.exact).toEqual([rule('/old', '/new')]);
    expect(redirects.dynamic).toEqual([rule('/docs/:slug', '/guides/:slug')]);
  });
});

describe('collapseRedirectsForSite', () => {
  const resolvesAsBefore = (rules: RedirectRule[]): void => {
    const before = buildSiteRedirectResolver(rules);
    const after = buildSiteRedirectResolver(collapseRedirectsForSite(rules));
    for (const address of rules.map((r) => r.source)) expect(after(address), address).toEqual(before(address));
  };

  it('keeps the first of two exact rules for one source, which the site runs', () => {
    const rules = [rule('/old/a', '/new/a'), rule('/old/a', '/other'), rule('/old/:slug*', '/new/:slug*')];
    expect(collapseRedirectsForSite(rules)).toEqual([rule('/old/:slug*', '/new/:slug*')]);
    resolvesAsBefore(rules);
    const firstDiffers = [rule('/old/a', '/other'), rule('/old/a/', '/new/a'), rule('/old/:slug*', '/new/:slug*')];
    expect(collapseRedirectsForSite(firstDiffers)).toEqual([rule('/old/a', '/other'), rule('/old/:slug*', '/new/:slug*')]);
    resolvesAsBefore(firstDiffers);
  });

  it('never lets a .md pattern stand in for a page rule', () => {
    const rules = [rule('/old/a', '/new/a'), rule('/old/:slug.md', '/new/:slug.md')];
    expect(collapseRedirectsForSite(rules)).toEqual(rules);
    resolvesAsBefore(rules);
  });

  it('sends every source where it went before, on a mixed set', () => {
    const rules = [
      rule('/old/a', '/new/a'), rule('/old/b', '/renamed/b'), rule('/old/c', '/new/c', 301), rule('/old/d/e', '/new/d/e'),
      rule('/old/f-1', '/new/f-1'), rule('/old/f-*', '/f-pages'), rule('/old/:slug*', '/new/:slug*'), rule('/old/:path*', '/never/:path*'),
      rule('/guide.md', '/handbook.md'),
    ];
    resolvesAsBefore(rules);
    expect(collapseRedirectsForSite(rules).map((r) => r.source)).toEqual(['/old/b', '/old/c', '/old/f-1', '/old/f-*', '/old/:slug*', '/guide.md']);
  });

  it('leaves out the exact rules a wildcard redirect already says', () => {
    const { exact, wildcard } = redirectMaps(plan([
      ['/old/a', '/new/a'], ['/old/b', '/new/b'], ['/old/c', '/new/c'], ['/elsewhere', '/start'],
    ]));
    expect(collapseRedirectsForSite([...exact, ...wildcard])).toEqual([rule('/elsewhere', '/start'), rule('/old/:slug*', '/new/:slug*')]);
  });

  it('keeps an exact rule that overrides the wildcard, since the site tries it first', () => {
    const rules = [rule('/old/a', '/renamed/a'), rule('/old/b', '/new/b'), rule('/old/:slug*', '/new/:slug*')];
    expect(collapseRedirectsForSite(rules)).toEqual([rule('/old/a', '/renamed/a'), rule('/old/:slug*', '/new/:slug*')]);
  });

  it('keeps an exact rule whose status code differs from the wildcard redirect', () => {
    const rules = [rule('/old/a', '/new/a', 301), rule('/old/:slug*', '/new/:slug*')];
    expect(collapseRedirectsForSite(rules)).toEqual(rules);
  });

  it('judges by the pattern the site would try first', () => {
    // the partial wildcard runs before the wildcard redirect, so it decides where /old/a-1 goes
    const rules = [rule('/old/a-1', '/new/a-1'), rule('/old/:slug*', '/new/:slug*'), rule('/old/a-*', '/archive')];
    expect(collapseRedirectsForSite(rules)).toEqual(rules);
  });

  it('keeps every rule when there is no pattern', () => {
    const rules = [rule('/a', '/b'), rule('/c', '/d')];
    expect(collapseRedirectsForSite(rules)).toEqual(rules);
  });
});
