/**
 * Images a repository page names by path. They were recorded as written and never looked for, so a
 * Fern, Mintlify or Docusaurus repository's own images all stayed paths the new site does not
 * serve, and `./diagram.png` in two folders was taken for one file.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collectAssets, repoAssetKey, repoAssetResolver, repoAssetRoots, resolveAssetUrl } from '../src/assets/manifest.js';
import { ensureWorkspace } from '../src/session/workspace.js';
import type { DocIR } from '../src/ir/types.js';

const write = (root: string, file: string, body: string | Buffer): void => { mkdirSync(join(root, dirname(file)), { recursive: true }); writeFileSync(join(root, file), body); };
const page = (source: string, url: string): DocIR => ({ pageId: source, platform: 'fern', source, frontmatter: { title: source }, children: [{ id: `${source}:img`, type: 'image', url, alt: 'x' }] });

describe('a repository page\'s images', () => {
  it('are keyed by where the file is, from the page\'s own folder', () => {
    expect(repoAssetKey('./diagram.png', 'fern/pages/guides/intro.mdx')).toBe('repo:fern/pages/guides/diagram.png');
    expect(repoAssetKey('../assets/a%20b.png?raw=1#x', 'fern/pages/intro.mdx')).toBe('repo:fern/assets/a b.png');
    expect(repoAssetKey('/images/logo.svg', 'fern/pages/intro.mdx')).toBe('repo:/images/logo.svg');
    // addresses, data and anchors are not files in the repository
    for (const url of ['https://cdn.example/x.png', '//cdn.example/x.png', 'data:image/png;base64,AA', '#top']) expect(repoAssetKey(url, 'fern/pages/intro.mdx')).toBeUndefined();
    // a live page still resolves against its own address
    expect(resolveAssetUrl('img/x.png', 'https://docs.example/guide/')).toBe('https://docs.example/guide/img/x.png');
  });

  it('read the bytes from the repository, as each platform serves a root path', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'dai-repo-assets-'));
    write(repo, 'fern/pages/a/diagram.png', 'first');
    write(repo, 'fern/pages/b/diagram.png', 'second');
    write(repo, 'fern/images/logo.png', 'logo');
    const workspace = mkdtempSync(join(tmpdir(), 'dai-repo-ws-')); ensureWorkspace(workspace);
    const docs = [page('fern/pages/a/one.mdx', './diagram.png'), page('fern/pages/b/two.mdx', './diagram.png'), page('fern/pages/b/three.mdx', '/images/logo.png'), page('fern/pages/b/four.mdx', './missing.png')];
    const manifest = await collectAssets(docs, workspace, { localResolver: repoAssetResolver(repo, repoAssetRoots('fern')), provider: 'local' });
    const statuses = Object.fromEntries(Object.entries(manifest.byUrl).map(([url, key]) => [url, manifest.entries[key].status]));
    expect(statuses).toEqual({
      'repo:fern/pages/a/diagram.png': 'downloaded',
      'repo:fern/pages/b/diagram.png': 'downloaded',
      'repo:/images/logo.png': 'downloaded',
      'repo:fern/pages/b/missing.png': 'failed',
    });
    // two files with the same name are two assets
    expect(manifest.byUrl['repo:fern/pages/a/diagram.png']).not.toBe(manifest.byUrl['repo:fern/pages/b/diagram.png']);
    expect(manifest.entries['repo:fern/pages/b/missing.png'].error).toBe('the repository has no file at fern/pages/b/missing.png');
  });

  it('never read a file outside the repository', () => {
    const repo = mkdtempSync(join(tmpdir(), 'dai-repo-escape-'));
    expect(repoAssetResolver(repo, [''])('repo:../../etc/passwd')).toBeUndefined();
  });
});
