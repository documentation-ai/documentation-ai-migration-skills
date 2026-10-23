/**
 * The addresses a Fern site serves its pages at, derived as Fern derives them.
 *
 * The adapter read pages at their file paths and ignored `slug:` and `skip-slug:`, so a migrated
 * Fern site moved every page to an address it never had, and its internal links broke with them.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFernRepo } from '../src/adapters/fern.js';
import type { SourceNavigationNode } from '../src/nav/tree.js';

const write = (root: string, file: string, body: string): void => { mkdirSync(join(root, dirname(file)), { recursive: true }); writeFileSync(join(root, file), body); };
const page = (title: string, extra = ''): string => `---\ntitle: ${title}\n${extra}---\n\n${title} body.\n`;

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dai-fern-'));
  for (const [file, body] of Object.entries(files)) write(root, file, body);
  return root;
}
const paths = (root: string): Record<string, string> => Object.fromEntries(readFernRepo(root).tree.pages.map((p) => [p.source.replace(/^fern\//, ''), p.oldPath!]));

describe('Fern page addresses', () => {
  it('names each level by its title made a slug, or by the slug it states', () => {
    const root = repo({
      'fern/docs.yml': [
        'instances:', '  - url: acme.docs.buildwithfern.com',
        'navigation:',
        '  - page: Welcome to Acme', '    path: ./pages/welcome.mdx',
        '  - section: Getting Started', '    contents:',
        '      - page: Install the CLI', '        path: ./pages/install.mdx',
        '      - page: OAuth 2.0 setup', '        path: ./pages/oauth.mdx', '        slug: oauth',
        '  - section: Guides', '    slug: how-to', '    contents:',
        '      - page: First request', '        path: ./pages/first.mdx',
        '',
      ].join('\n'),
      'fern/pages/welcome.mdx': page('Welcome'),
      'fern/pages/install.mdx': page('Install'),
      'fern/pages/oauth.mdx': page('OAuth'),
      'fern/pages/first.mdx': page('First'),
    });
    expect(paths(root)).toEqual({
      'pages/welcome.mdx': '/welcome-to-acme',
      'pages/install.mdx': '/getting-started/install-the-cli',
      'pages/oauth.mdx': '/getting-started/oauth',
      'pages/first.mdx': '/how-to/first-request',
    });
  });

  it('adds nothing for skip-slug, and a frontmatter slug replaces the path below the basepath', () => {
    const root = repo({
      'fern/docs.yml': [
        'instances:', '  - url: acme.docs.buildwithfern.com/docs',
        'tabs:', '  guides:', '    display-name: Guides', '  api:', '    display-name: API Reference', '    skip-slug: true',
        'navigation:',
        '  - tab: guides', '    layout:',
        '      - section: Basics', '        skip-slug: true', '        contents:',
        '          - page: Quickstart', '            path: ./pages/quickstart.mdx',
        '          - page: Moved', '            path: ./pages/moved.mdx',
        '  - tab: api', '    layout:',
        '      - page: Authentication', '        path: ./pages/auth.mdx',
        '',
      ].join('\n'),
      'fern/pages/quickstart.mdx': page('Quickstart'),
      'fern/pages/moved.mdx': page('Moved', 'slug: elsewhere/moved-page\n'),
      'fern/pages/auth.mdx': page('Auth'),
    });
    expect(paths(root)).toEqual({
      'pages/quickstart.mdx': '/docs/guides/quickstart',
      'pages/moved.mdx': '/docs/elsewhere/moved-page',
      'pages/auth.mdx': '/docs/authentication',
    });
  });

  it('opens a section on its overview page, at the section\'s own address, labelled as the sidebar shows it', () => {
    const root = repo({
      'fern/docs.yml': ['navigation:', '  - section: SDKs', '    path: ./pages/sdks.mdx', '    contents:', '      - page: Python', '        path: ./pages/python.mdx', ''].join('\n'),
      'fern/pages/sdks.mdx': page('Software development kits', 'sidebar-title: SDKs overview\n'),
      'fern/pages/python.mdx': page('Python SDK', 'sidebar-title: Python\n'),
    });
    const { tree } = readFernRepo(root);
    // lodash's kebabCase splits "SDKs" at its case change: Fern serves this section at /sd-ks, so the migration keeps it there
    expect(paths(root)).toEqual({ 'pages/sdks.mdx': '/sd-ks', 'pages/python.mdx': '/sd-ks/python' });
    const section = tree.navigation![0] as Extract<SourceNavigationNode, { type: 'group' }>;
    expect(section).toMatchObject({ type: 'group', label: 'SDKs overview', pageId: tree.pages[0].id });
    // the page keeps its own title; the sidebar shows the sidebar title
    expect(tree.pages[1]).toMatchObject({ title: 'Python SDK', sidebarTitle: 'Python' });
  });

  it('reads a folder as Fern does: index page as overview, files named by their file names, ordered by position then title', () => {
    const root = repo({
      'fern/docs.yml': ['navigation:', '  - folder: ./pages/guides', ''].join('\n'),
      'fern/pages/guides/index.mdx': page('All guides'),
      'fern/pages/guides/Zeta Topic.mdx': page('Zeta'),
      'fern/pages/guides/alpha_topic.mdx': page('Alpha'),
      'fern/pages/guides/pinned.mdx': page('Pinned', 'position: 1\n'),
      'fern/pages/guides/_draft.mdx': page('Draft'),
      'fern/pages/guides/advanced/deep.mdx': page('Deep'),
    });
    const { tree, unreferenced } = readFernRepo(root);
    expect(paths(root)).toEqual({
      'pages/guides/index.mdx': '/guides',
      'pages/guides/pinned.mdx': '/guides/pinned',
      'pages/guides/advanced/deep.mdx': '/guides/advanced/deep',
      'pages/guides/alpha_topic.mdx': '/guides/alphatopic',
      'pages/guides/Zeta Topic.mdx': '/guides/zeta-topic',
    });
    const folder = tree.navigation![0] as Extract<SourceNavigationNode, { type: 'group' }>;
    expect(folder.label).toBe('Guides');
    expect(folder.children.map((child) => (child.type === 'group' ? child.label : child.title))).toEqual(['Pinned', 'Advanced', 'Alpha Topic', 'Zeta Topic']);
    expect(unreferenced).toEqual(['fern/pages/guides/_draft.mdx']);
  });

  it('prefixes versions, serves the default one without its prefix, and keeps the prefix as an alias', () => {
    const root = repo({
      'fern/docs.yml': ['versions:', '  - display-name: v2', '    path: ./versions/v2.yml', '  - display-name: Version 1', '    path: ./versions/v1.yml', '    slug: v1', ''].join('\n'),
      'fern/versions/v2.yml': ['navigation:', '  - page: Start', '    path: ../pages/v2/start.mdx', ''].join('\n'),
      'fern/versions/v1.yml': ['navigation:', '  - page: Start', '    path: ../pages/v1/start.mdx', ''].join('\n'),
      'fern/pages/v2/start.mdx': page('Start'),
      'fern/pages/v1/start.mdx': page('Start'),
    });
    const { tree } = readFernRepo(root);
    expect(tree.defaultVersion).toBe('v2');
    // a version named "v2" with no slug is served under /v-2: kebabCase separates letters from digits
    expect(tree.pages.map((p) => ({ old: p.oldPath, aliases: p.aliases, version: p.version, versionPath: p.versionPath }))).toEqual([
      { old: '/start', aliases: ['/v-2/start'], version: 'v2', versionPath: 'v-2' },
      { old: '/v1/start', aliases: undefined, version: 'Version 1', versionPath: 'v1' },
    ]);
  });

  it('dates changelog entries as Fern does, newest first, below the changelog\'s address', () => {
    const root = repo({
      'fern/docs.yml': ['navigation:', '  - changelog: ./changelog', '    title: Release notes', ''].join('\n'),
      'fern/changelog/overview.mdx': page('Release notes'),
      'fern/changelog/2024-01-05.mdx': '## New things\n',
      'fern/changelog/2024-11-20.md': '## More things\n',
    });
    const { tree } = readFernRepo(root);
    expect(paths(root)).toEqual({ 'changelog/overview.mdx': '/release-notes', 'changelog/2024-11-20.md': '/release-notes/2024/11/20', 'changelog/2024-01-05.mdx': '/release-notes/2024/1/5' });
    expect(tree.pages.map((p) => p.title)).toEqual(['Release notes', 'November 20, 2024', 'January 5, 2024']);
  });

  it('places a file named twice once, and redirects its second address', () => {
    const root = repo({
      'fern/docs.yml': ['navigation:', '  - page: Intro', '    path: ./pages/intro.mdx', '  - section: Again', '    contents:', '      - page: Intro', '        path: ./pages/intro.mdx', ''].join('\n'),
      'fern/pages/intro.mdx': page('Intro'),
    });
    const { tree } = readFernRepo(root);
    expect(tree.pages).toHaveLength(1);
    expect(tree.pages[0]).toMatchObject({ oldPath: '/intro', aliases: ['/again/intro'] });
  });

  it('reports navigation links to other sites instead of dropping them silently', () => {
    const root = repo({
      'fern/docs.yml': ['navigation:', '  - page: Intro', '    path: ./pages/intro.mdx', '  - link: Status', '    href: https://status.acme.com', ''].join('\n'),
      'fern/pages/intro.mdx': page('Intro'),
    });
    expect(readFernRepo(root).links).toEqual([{ title: 'Status', href: 'https://status.acme.com' }]);
  });
});
