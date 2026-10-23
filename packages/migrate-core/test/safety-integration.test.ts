import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { collectAssets, readManifest } from '../src/assets/manifest.js';
import { d360ArticleToIr, extractIfZip, type D360Article } from '../src/adapters/document360.js';
import { ensureWorkspace } from '../src/session/workspace.js';
import { sha256 } from '../src/session/ids.js';
import { MigrationBranchExistsError, writeMigrationBranch } from '../src/write/migration-branch.js';
import type { DocIR } from '../src/ir/types.js';

const cleanup: string[] = [];
function temp(prefix: string): string {
  const p = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(p);
  return p;
}
afterEach(() => { while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true }); });

describe('binary assets', () => {
  it('hashes and persists exact response bytes rather than an UTF-8 round trip', async () => {
    const workspace = temp('dai-assets-'); ensureWorkspace(workspace);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0x80]);
    const doc: DocIR = { pageId: 'p', platform: 'x', source: 'x', frontmatter: { title: 'X' }, children: [{ id: 'img', type: 'image', url: 'https://cdn.example.test/x.png', alt: 'x' }] };
    const fetcher = { get: async () => ({ status: 200, body: '', bodyBase64: bytes.toString('base64'), contentType: 'image/png' }) };
    await collectAssets([doc], workspace, { fetcher: fetcher as never, provider: 'local' });
    const manifest = readManifest(workspace);
    const entry = manifest.entries[sha256(bytes)];
    expect(entry).toBeDefined();
    expect(readFileSync(entry.localPath!)).toEqual(bytes);
  });
});

describe('Document360 archives and Markdown articles', () => {
  it('rejects a ZIP entry that escapes the extraction root', async () => {
    const root = temp('dai-zip-');
    const file = join(root, 'bad.zip');
    const extract = join(root, 'extract');
    mkdirSync(extract);
    writeFileSync(join(extract, 'previous.txt'), 'keep');
    writeFileSync(file, zipSync({ '../evil.txt': strToU8('x') }));
    await expect(extractIfZip(file, extract)).rejects.toThrow(/Relative path|outside target/);
    expect(existsSync(join(root, 'evil.txt'))).toBe(false);
    expect(readFileSync(join(extract, 'previous.txt'), 'utf8')).toBe('keep');
  });

  it('extracts a valid ZIP through a staged directory', async () => {
    const root = temp('dai-zip-good-');
    const file = join(root, 'good.zip');
    writeFileSync(file, zipSync({ 'workspace/Articles/guide.md': strToU8('# Guide\n') }));
    const extracted = await extractIfZip(file, join(root, 'extract'));
    expect(readFileSync(join(extracted, 'workspace', 'Articles', 'guide.md'), 'utf8')).toBe('# Guide\n');
  });

  it('converts Markdown-editor articles instead of skipping them', () => {
    const root = temp('dai-d360-md-');
    const file = join(root, 'guide.md');
    writeFileSync(file, '<!-- ## Metadata_Start\ntitle: Markdown guide\n## Metadata_End -->\n\n# Hello\n\nA **complete** article.\n');
    const article: D360Article = { platformId: 'article-1', title: 'Markdown guide', slug: 'guide', file, format: 'md', categoryPath: [], order: 0, metadata: {}, workspace: 'v1' };
    const doc = d360ArticleToIr(article, root);
    expect(doc.frontmatter.title).toBe('Markdown guide');
    expect(doc.children.map((x) => x.type)).toEqual(['heading', 'paragraph']);
  });
});

describe('Git migration writer', () => {
  const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  it('commits through an isolated worktree and leaves the operator checkout untouched', () => {
    const root = temp('dai-git-');
    const bare = join(root, 'remote.git');
    const seed = join(root, 'seed');
    const repo = join(root, 'checkout');
    const output = join(root, 'output');
    mkdirSync(output);
    git(root, ['init', '--quiet', '--bare', bare]);
    git(root, ['clone', '--quiet', bare, seed]);
    git(seed, ['config', 'user.name', 'Test']);
    git(seed, ['config', 'user.email', 'test@example.com']);
    writeFileSync(join(seed, 'README.md'), 'original\n');
    git(seed, ['add', 'README.md']); git(seed, ['commit', '--quiet', '-m', 'seed']); git(seed, ['branch', '-M', 'main']); git(seed, ['push', '--quiet', '-u', 'origin', 'main']);
    git(bare, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    git(root, ['clone', '--quiet', bare, repo]);
    git(repo, ['remote', 'set-url', 'origin', 'https://github.com/acme-docs/site.git']);
    git(repo, ['config', `url.file://${bare}.insteadOf`, 'https://github.com/acme-docs/site.git']);
    writeFileSync(join(repo, 'operator-notes.txt'), 'do not touch\n');
    writeFileSync(join(output, 'documentation.json'), '{"navigation":{"pages":["guide"]}}\n');
    writeFileSync(join(output, 'guide.mdx'), '---\ntitle: Guide\n---\n\nHello\n');

    const result = writeMigrationBranch({ repoDir: repo, outputDir: output, sessionId: 'session-1', remote: 'https://github.com/acme-docs/site.git', allowedRemoteOrgs: ['acme-docs'] });
    expect(result.branch).toBe('migration/session-1');
    expect(git(repo, ['branch', '--show-current'])).toBe('main');
    expect(readFileSync(join(repo, 'operator-notes.txt'), 'utf8')).toBe('do not touch\n');
    expect(git(repo, ['show', `${result.commit}:guide.mdx`])).toContain('Hello');
  });

  /** A remote with `main`, its clone, and an output to write; `files` seeds `main`. */
  function hosted(files: Record<string, string>) {
    const root = temp('dai-git-');
    const bare = join(root, 'remote.git'); const seed = join(root, 'seed'); const repo = join(root, 'checkout'); const output = join(root, 'output');
    mkdirSync(output);
    git(root, ['init', '--quiet', '--bare', bare]);
    git(root, ['clone', '--quiet', bare, seed]);
    git(seed, ['config', 'user.name', 'Test']); git(seed, ['config', 'user.email', 'test@example.com']);
    for (const [path, content] of Object.entries(files)) { mkdirSync(join(seed, path, '..'), { recursive: true }); writeFileSync(join(seed, path), content); }
    git(seed, ['add', '-A']); git(seed, ['commit', '--quiet', '-m', 'seed']); git(seed, ['branch', '-M', 'main']); git(seed, ['push', '--quiet', '-u', 'origin', 'main']);
    git(bare, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    git(root, ['clone', '--quiet', bare, repo]);
    git(repo, ['remote', 'set-url', 'origin', 'https://github.com/acme-docs/site.git']);
    git(repo, ['config', `url.file://${bare}.insteadOf`, 'https://github.com/acme-docs/site.git']);
    writeFileSync(join(output, 'documentation.json'), '{"navigation":{"pages":["guide"]}}\n');
    writeFileSync(join(output, 'guide.mdx'), '---\ntitle: Guide\n---\n\nHello\n');
    const write = (sessionId: string, extra: Partial<Parameters<typeof writeMigrationBranch>[0]> = {}) => writeMigrationBranch({ repoDir: repo, outputDir: output, sessionId, remote: 'https://github.com/acme-docs/site.git', allowedRemoteOrgs: ['acme-docs'], ...extra });
    return { bare, repo, write };
  }

  /**
   * Started from origin/main, the branch tracked it: GitHub Desktop's Push (or a plain `git push`)
   * then sent the documentation-only commit to main, deleting everything else in the repository.
   */
  it('leaves an unpushed branch tracking nothing, and a pushed one tracking itself', () => {
    const { repo, write } = hosted({ 'README.md': 'original\n' });
    write('local-only');
    expect(() => git(repo, ['rev-parse', '--abbrev-ref', 'migration/local-only@{upstream}'])).toThrow();
    write('pushed', { push: true });
    expect(git(repo, ['rev-parse', '--abbrev-ref', 'migration/pushed@{upstream}'])).toBe('origin/migration/pushed');
  });

  it('refuses to replace a repository that holds code, unless the person says so', () => {
    const { repo, write } = hosted({ 'package.json': '{}\n', 'src/index.ts': 'export {};\n', 'docs/intro.md': '# Intro\n' });
    expect(() => write('code')).toThrow(/holds a software project[\s\S]*package\.json, src\/index\.ts[\s\S]*--replace-repo-contents/);
    // refused before anything was made, so nothing is left to collide with later
    expect(() => git(repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/migration/code'])).toThrow();
    expect(write('code', { replaceRepoContents: true }).branch).toBe('migration/code');
  });

  it('names a taken branch with an error the CLI can answer with a revision', () => {
    const { write } = hosted({ 'README.md': 'original\n' });
    write('taken', { push: true });
    expect(() => write('taken')).toThrow(MigrationBranchExistsError);
  });

  it('leaves no branch behind when the write stops half-way, so running it again works', () => {
    const { bare, repo, write } = hosted({ 'README.md': 'original\n' });
    writeFileSync(join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\necho refused >&2\nexit 1\n', { mode: 0o755 });
    expect(() => write('again', { push: true })).toThrow();
    expect(() => git(repo, ['rev-parse', '--verify', '--quiet', 'refs/heads/migration/again'])).toThrow();
    rmSync(join(bare, 'hooks', 'pre-receive'));
    expect(write('again', { push: true }).pushed).toBe(true);
  });
});
