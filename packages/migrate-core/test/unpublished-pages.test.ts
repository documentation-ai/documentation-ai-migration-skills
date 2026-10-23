/**
 * The source universe is counted independently of the adapter, so it has to know what each platform
 * actually publishes. Counting a Docusaurus draft or a file Fern never builds as published demands
 * a scope decision for a page the source never served — an operator writing exclusions for pages
 * nobody can read.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { nativeSourceManifest } from '../src/evidence/capture.js';
import { freezeDirectory } from '../src/evidence/manifest.js';

const write = (root: string, file: string, body: string): void => {
  mkdirSync(join(root, dirname(file)), { recursive: true });
  writeFileSync(join(root, file), body);
};

/** The manifest as discovery builds it: over a frozen copy, never the working directory. */
function manifestOf(platform: string, build: (root: string) => void) {
  const source = mkdtempSync(join(tmpdir(), 'dai-universe-src-'));
  build(source);
  const frozenRoot = join(mkdtempSync(join(tmpdir(), 'dai-universe-ws-')), 'frozen');
  const freeze = freezeDirectory(source, frozenRoot);
  return nativeSourceManifest({
    platform, kind: 'repo', root: frozenRoot, freeze,
    location: source, contentContractVersion: '0.1.0', capturedAt: '2026-01-01T00:00:00.000Z',
  });
}

const published = (manifest: ReturnType<typeof manifestOf>): string[] => manifest.pages.filter((page) => page.published).map((page) => page.location).sort();
const unpublished = (manifest: ReturnType<typeof manifestOf>): string[] => manifest.pages.filter((page) => !page.published).map((page) => page.location).sort();

describe('what each platform actually publishes', () => {
  it('counts the pages Fern version files and changelog folders name, relative to the file naming them', () => {
    const manifest = manifestOf('fern', (root) => {
      write(root, 'fern/docs.yml', ['versions:', '  - display-name: v2', '    path: ./versions/v2.yml', 'navigation:', '  - changelog: ./changelog', ''].join('\n'));
      write(root, 'fern/versions/v2.yml', ['navigation:', '  - page: Start', '    path: ../pages/start.mdx', ''].join('\n'));
      write(root, 'fern/pages/start.mdx', '---\ntitle: Start\n---\n\nGo.\n');
      write(root, 'fern/changelog/2024-01-05.mdx', 'New.\n');
      write(root, 'fern/pages/scratch.mdx', 'Not referenced.\n');
    });
    expect(published(manifest)).toEqual(['fern/changelog/2024-01-05.mdx', 'fern/pages/start.mdx']);
    expect(unpublished(manifest)).toEqual(['fern/pages/scratch.mdx']);
  });

  it('does not count a README beside a Docusaurus site as one of its pages', () => {
    const manifest = manifestOf('docusaurus', (root) => {
      write(root, 'docusaurus.config.ts', 'export default {};\n');
      write(root, 'README.md', '# Website\n\nHow to build it.\n');
      write(root, 'docs/intro.md', '---\ntitle: Introduction\n---\n\nPublished.\n');
      write(root, 'blog/2024-01-01-hello.md', '---\ntitle: Hello\n---\n\nA post.\n');
    });
    expect(published(manifest)).toEqual(['blog/2024-01-01-hello.md', 'docs/intro.md']);
    expect(unpublished(manifest)).toEqual(['README.md']);
  });

  it('does not count a Docusaurus draft or unlisted page as published', () => {
    const manifest = manifestOf('docusaurus', (root) => {
      write(root, 'docusaurus.config.ts', 'export default {};\n');
      write(root, 'docs/intro.md', '---\ntitle: Introduction\n---\n\nPublished.\n');
      write(root, 'docs/secret.md', '---\ntitle: Secret\ndraft: true\n---\n\nA draft.\n');
      write(root, 'docs/quiet.md', '---\ntitle: Quiet\nunlisted: true\n---\n\nUnlisted.\n');
    });
    expect(published(manifest)).toEqual(['docs/intro.md']);
    expect(unpublished(manifest)).toEqual(['docs/quiet.md', 'docs/secret.md']);
  });

  it('counts only the files Fern builds, which are the ones docs.yml reaches', () => {
    const manifest = manifestOf('fern', (root) => {
      write(root, 'fern/docs.yml', [
        'instances:', '  - url: a.docs.buildwithfern.com', 'navigation:',
        '  - page: Welcome', '    path: ./pages/welcome.mdx',
        '  - section: Guides', '    contents:', '      - folder: ./pages/guides', '',
      ].join('\n'));
      write(root, 'fern/pages/welcome.mdx', '---\ntitle: Welcome\n---\n\nStart.\n');
      write(root, 'fern/pages/guides/install.mdx', '---\ntitle: Install\n---\n\nRun it.\n');
      write(root, 'fern/pages/scratch.mdx', '---\ntitle: Scratch\n---\n\nNot referenced.\n');
    });
    // a folder entry publishes what is inside it; a file no entry reaches is not built at all
    expect(published(manifest)).toEqual(['fern/pages/guides/install.mdx', 'fern/pages/welcome.mdx']);
    expect(unpublished(manifest)).toEqual(['fern/pages/scratch.mdx']);
  });

  it('counts Nextra content pages, which have no draft state outside the code it will not read', () => {
    const manifest = manifestOf('nextra', (root) => {
      write(root, 'package.json', '{"dependencies":{"nextra":"4.0.0"}}');
      write(root, 'content/index.mdx', '---\ntitle: Welcome\n---\n\nStart.\n');
      write(root, 'content/guides/install.mdx', '# Install\n\nRun it.\n');
    });
    expect(published(manifest)).toEqual(['content/guides/install.mdx', 'content/index.mdx']);
    expect(unpublished(manifest)).toEqual([]);
  });

  it('reports a Fern repository with no docs.yml rather than guessing what it publishes', () => {
    const manifest = manifestOf('fern', (root) => write(root, 'fern/pages/orphan.mdx', '---\ntitle: Orphan\n---\n\nNo config.\n'));
    expect(manifest.issues?.join(' ')).toContain('no fern/docs.yml');
  });
});
