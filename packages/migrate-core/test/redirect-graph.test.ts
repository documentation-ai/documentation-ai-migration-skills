/**
 * Redirects fail as a set, not as rules. Each rule here is well-formed on its own; together they
 * loop, chain, claim one old path twice, or land where no page was written — and a reader finds out
 * by clicking an old link on the day the domain moves.
 */
import { describe, it, expect } from 'vitest';
import { redirectProblems } from '../src/urls/redirect-graph.js';
import type { RedirectRule } from '../src/urls/plan.js';

const rule = (source: string, destination: string): RedirectRule => ({ source, destination, statusCode: 308 });
const kinds = (problems: ReturnType<typeof redirectProblems>): string[] => problems.map((problem) => problem.kind).sort();

describe('redirects read as a graph', () => {
  it('passes a set that simply moves paths', () => {
    expect(redirectProblems([rule('/old-guide', '/guides/install'), rule('/legacy', '/index')], new Set(['guides/install', 'index']))).toEqual([]);
  });

  it('reports two rules claiming the same old path', () => {
    const problems = redirectProblems([rule('/a', '/b'), rule('/a', '/c')], new Set(['b', 'c']));
    expect(kinds(problems)).toContain('conflict');
    expect(problems[0].detail).toContain('/a is redirected to');
  });

  it('reports a redirect whose destination is itself redirected', () => {
    const problems = redirectProblems([rule('/a', '/b'), rule('/b', '/c')], new Set(['c']));
    expect(kinds(problems)).toContain('chain');
    expect(problems.find((problem) => problem.kind === 'chain')?.detail).toContain('/a → /b → /c');
  });

  it('reports a cycle rather than following it forever', () => {
    const problems = redirectProblems([rule('/a', '/b'), rule('/b', '/a')], new Set());
    expect(kinds(problems)).toContain('loop');
  });

  it('reports two old paths that differ only by case', () => {
    const problems = redirectProblems([rule('/Guides/Install', '/guides/install'), rule('/guides/install', '/guides/setup')], new Set(['guides/install', 'guides/setup']));
    expect(kinds(problems)).toContain('case-collision');
  });

  it('reports a destination no written page answers, and accepts an index page', () => {
    expect(kinds(redirectProblems([rule('/old', '/gone')], new Set(['guides/install'])))).toContain('missing-target');
    // routes come as listOutputPageRoutes gives them: an index page also at its folder
    expect(redirectProblems([rule('/old', '/guides')], new Set(['guides/index', 'guides']))).toEqual([]);
    // a destination that leaves the site is somebody else's to answer
    expect(redirectProblems([rule('/old', 'https://status.example.com')], new Set(['a']))).toEqual([]);
  });

  it('accepts an exact rule beneath a wildcard redirect, which the site always tries first', () => {
    // the exact rule overrides the wildcard for its one path; nothing depends on the host's order
    expect(redirectProblems([rule('/docs/:slug*', '/guides/:slug*'), rule('/docs/install', '/setup/install')], new Set(['guides/install', 'setup/install']))).toEqual([]);
    expect(redirectProblems([rule('/docs/:slug*', '/guides/:slug*'), rule('/docs/install', '/guides/install')], new Set(['guides/install']))).toEqual([]);
  });

  it('does not report a pattern destination as a missing page', () => {
    expect(redirectProblems([rule('/docs/:slug', '/guides/:slug'), rule('/beta/:slug*', '/v2/:slug*')], new Set(['guides/install']))).toEqual([]);
  });

  it('reports a wildcard redirect that sends readers back inside its own source', () => {
    const problems = redirectProblems([rule('/docs/:slug*', '/docs/v2/:slug*')], new Set(['docs/v2/a']));
    expect(kinds(problems)).toContain('loop');
  });

  it('reports a pattern that also matches written pages, naming them', () => {
    const problems = redirectProblems([rule('/api/:slug*', '/reference/:slug*')], new Set(['api/overview', 'api/auth', 'guides/index', 'guides']));
    expect(kinds(problems)).toEqual(['covers-page']);
    expect(problems[0].detail).toContain('/api/overview');
    // a written index page answers at its folder's address, which the route list carries
    expect(kinds(redirectProblems([rule('/guides/:slug*', '/handbook/:slug*')], new Set(['guides/index', 'guides'])))).toEqual(['covers-page']);
  });

  it('reports two pattern rules for one source, however their names are spelled', () => {
    expect(kinds(redirectProblems([rule('/old/:slug*', '/a/:slug*'), rule('/old/:slug*', '/b/:slug*')], new Set()))).toEqual(['conflict']);
    expect(kinds(redirectProblems([rule('/old/:slug*', '/a/:slug*'), rule('/old/:path*/', '/b/:path*')], new Set()))).toEqual(['conflict']);
  });

  it('reports a loop that runs through patterns', () => {
    expect(kinds(redirectProblems([rule('/a/:slug*', '/b/:slug*'), rule('/b/:slug*', '/a/:slug*')], new Set()))).toEqual(['loop', 'loop']);
    // an exact rule back into a wildcard redirect's source
    const problems = redirectProblems([rule('/new/x', '/old/x'), rule('/old/:slug*', '/new/:slug*')], new Set(['new/y']));
    expect(kinds(problems)).toContain('loop');
    expect(problems.find((problem) => problem.kind === 'loop')?.detail).toContain('/new/x → /old/x → /new/x');
  });

  it('reports a chain that runs through a pattern', () => {
    const problems = redirectProblems([rule('/x', '/old/y'), rule('/old/:slug*', '/new/:slug*')], new Set(['new/y']));
    expect(kinds(problems)).toEqual(['chain']);
    expect(problems[0].detail).toContain('/x → /old/y → /new/y');
  });

  it('finds the page a destination with an anchor, a query or a .md address lands on', () => {
    expect(redirectProblems([rule('/a', '/guides/setup#install'), rule('/b', '/guides/setup?tab=cli'), rule('/c', '/guides/setup.md')], new Set(['guides/setup']))).toEqual([]);
    expect(kinds(redirectProblems([rule('/a', '/guides/gone#install')], new Set(['guides/setup'])))).toEqual(['missing-target']);
  });

  it('reports a rule whose old path carries a query or fragment, which never matches', () => {
    expect(kinds(redirectProblems([rule('/old?page=2', '/new')], new Set(['new'])))).toContain('lost-query');
  });
});
