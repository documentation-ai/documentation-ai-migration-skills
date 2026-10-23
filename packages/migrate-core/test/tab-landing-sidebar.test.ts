/**
 * What the rendered sidebar is expected to list, on a tabbed target.
 *
 * demo-64.gitbook.io publishes a one-page Home tab with no sidebar, and Changelog and Help Center
 * tabs that open on their own page. The migration writes those pages as the tab's page and as the
 * tab's `path`, and the platform opens them from the top bar; no sidebar lists them. Expecting them
 * there failed the preview of a site whose navigation was intact, and the site-wide finding could
 * not even be accepted, because acceptances were applied before the site row existed.
 */
import { describe, it, expect } from 'vitest';
import { expectedSidebar } from '../src/cli/evidence.js';
import type { Tree, TreePage } from '../src/nav/tree.js';
import { markdownToIr } from '../src/ir/from-markdown.js';
import { runBrowserContentGate } from '../src/verify/browser.js';

const page = (id: string, title: string, newPath: string, extra: Partial<TreePage> = {}): TreePage =>
  ({ id, title, newPath, migrate: true, source: `https://docs.example/${newPath}`, ...extra }) as TreePage;

describe('the sidebar a tabbed site is expected to draw', () => {
  const tree: Tree = {
    scope: 'full',
    platform: 'gitbook',
    pages: [
      page('home', 'Developer Platform', 'docs', { sourceSidebar: 'absent' }),
      page('log', 'Changelog', 'docs/changelog'),
      page('u1', 'Product update', 'docs/changelog/2026/product-update'),
      page('guide', 'Getting started', 'docs/guides/getting-started'),
      page('quick', 'Quickstart', 'docs/guides/quickstart'),
      page('api', 'Pets API', 'docs/api'),
      page('pets', 'List pets', 'docs/api/pets'),
    ],
    navigation: [
      { type: 'group', kind: 'tab', label: 'Home', children: [{ type: 'page', pageId: 'home', title: 'Developer Platform' }] },
      { type: 'group', kind: 'tab', label: 'Changelog', children: [
        { type: 'page', pageId: 'log', title: 'Changelog' },
        { type: 'group', label: '2026', children: [{ type: 'page', pageId: 'u1', title: 'Product update' }] },
      ] },
      { type: 'group', kind: 'tab', label: 'Guides', children: [
        { type: 'group', label: 'Getting started', children: [{ type: 'page', pageId: 'guide', title: 'Getting started' }, { type: 'page', pageId: 'quick', title: 'Quickstart' }] },
      ] },
      { type: 'group', kind: 'tab', label: 'Pets API', children: [{ type: 'page', pageId: 'api', title: 'Pets API' }, { type: 'page', pageId: 'pets', title: 'List pets' }] },
    ],
  };

  it('leaves out a tab opened on its own page from the top bar, and a tab that draws no sidebar', () => {
    const labels = expectedSidebar(tree).map((entry) => entry.label);
    // Home renders no sidebar; Changelog and Pets API are their tabs' own pages
    expect(labels).toEqual(['Product update', 'Getting started', 'Quickstart', 'List pets']);
  });

  it('keeps a plain group\'s landing page, and a tab page bound to an operation, which stay sidebar entries', () => {
    expect(expectedSidebar(tree, new Set(['api'])).map((entry) => entry.label)).toContain('Pets API');
    const flat: Tree = { ...tree, navigation: [{ type: 'group', label: 'Changelog', children: [{ type: 'page', pageId: 'log', title: 'Changelog' }, { type: 'page', pageId: 'u1', title: 'Product update' }] }] };
    expect(expectedSidebar(flat).map((entry) => entry.label)).toEqual(['Changelog', 'Product update']);
    // a page without a sidebar outside any tab is still listed by the one sidebar every other page draws
    const untabbed: Tree = { ...tree, navigation: [{ type: 'page', pageId: 'home', title: 'Developer Platform' }, { type: 'page', pageId: 'quick', title: 'Quickstart' }] };
    expect(expectedSidebar(untabbed).map((entry) => entry.label)).toEqual(['Developer Platform', 'Quickstart']);
  });

  it('lets a named person accept a site-wide sidebar finding', async () => {
    const doc = markdownToIr(`---\ntitle: Home\n---\n\nOne.\n`, { platform: 'gitbook', file: 'index.md', pageId: 'p' });
    const render = async () => `<html><head><title>Home - Acme Docs</title></head><body><nav><a href="/x">Quickstart</a></nav><main><h1>Home</h1><p>One.</p></main></body></html>`;
    const options = { navigation: [{ groupPath: ['Home'], label: 'Home' }], navSelector: 'nav', siteName: 'Acme Docs', render };
    const pages = [{ id: 'p', newPath: 'index', migrate: true, doc }];
    const failing = await runBrowserContentGate('https://preview.example/', pages, options);
    expect(failing.gate.status).toBe('fail');
    const accepted = new Map([['(site)', { by: 'Asha Rao', reason: 'Home opens from its tab' }]]);
    const result = await runBrowserContentGate('https://preview.example/', pages, { ...options, accepted });
    expect(result.gate.status).toBe('pass');
    const site = result.routes.find((route) => route.route === '(site)')!;
    expect(site).toMatchObject({ status: 'pass', accepted: accepted.get('(site)') });
    expect(site.problems.join(' ')).toContain('navigation entries no rendered sidebar or top bar shows');
  });

  /**
   * The rendered navigation is read as links, not only labels: the demo-64 preview drew "Developer
   * Platform" as a tab named "Home", and Changelog and Help Center as tabs, which the label check
   * counted as missing on a preview whose navigation was intact.
   */
  describe('a placement the platform draws as a link to its page', () => {
    const doc = (title: string) => markdownToIr(`---\ntitle: ${title}\n---\n\nOne.\n`, { platform: 'gitbook', file: `${title}.md`, pageId: title });
    const pages = [
      { id: 'home', newPath: 'docs', migrate: true, doc: doc('Developer Platform') },
      { id: 'quick', newPath: 'docs/guides/quickstart', migrate: true, doc: doc('Quickstart') },
    ];
    const topBar = '<div class="dai-navbar-tabs"><a href="/docs">Home</a><a href="/docs/guides/quickstart">Guides</a></div>';
    const page = (route: string, sidebar: string) => `<html><head><title>${route} - Acme Docs</title></head><body>${topBar}${sidebar}<main><h1>${route === 'docs' ? 'Developer Platform' : 'Quickstart'}</h1><p>One.</p></main></body></html>`;
    // the Home tab's page draws no sidebar; the guides tab's sidebar lists its pages
    const render = async (url: string) => (url.endsWith('/docs') ? page('docs', '') : page('quickstart', '<aside class="dai-sidebar"><a href="/docs/guides/quickstart/">Quick start</a></aside>'));
    const navigation = [
      { groupPath: ['Home'], label: 'Developer Platform', route: 'docs' },
      { groupPath: ['Guides'], label: 'Quickstart', route: 'docs/guides/quickstart' },
    ];
    const options = { navigation, navSelector: '.dai-sidebar', topBarSelector: '.dai-navbar-tabs', siteName: 'Acme Docs', render };

    it('counts a page opened from the top bar, or listed under another label, as drawn', async () => {
      const result = await runBrowserContentGate('https://preview.example/', pages, options);
      expect(result.routes.find((route) => route.route === '(site)')).toMatchObject({ status: 'pass', problems: [] });
    });

    it('still fails a placement no surface links to or names', async () => {
      const lost = await runBrowserContentGate('https://preview.example/', pages, { ...options, navigation: [...navigation, { groupPath: ['Guides'], label: 'Webhooks', route: 'docs/guides/webhooks' }] });
      const site = lost.routes.find((route) => route.route === '(site)')!;
      expect(site.status).toBe('fail');
      expect(site.problems.join(' ')).toContain('"webhooks" placed 1\u00d7, shown 0\u00d7');
    });

    it('needs a sidebar or top bar on some route, not on the first one', async () => {
      const bare = async () => '<html><head><title>x - Acme Docs</title></head><body><main><h1>Developer Platform</h1><p>One.</p></main></body></html>';
      const none = await runBrowserContentGate('https://preview.example/', pages, { ...options, render: bare });
      expect(none.routes.find((route) => route.route === '(site)')!.problems.join(' ')).toContain('no rendered navigation matched');
    });
  });
});
