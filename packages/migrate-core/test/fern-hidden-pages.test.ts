/**
 * A page Fern publishes but hides from its sidebar (`hidden: true` in docs.yml) migrates and is
 * reported as unlisted, as a crawled site's is. Left unmarked, nav refused every such page as one
 * the navigation had lost.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

describe('Fern hidden pages', () => {
  it('are marked unlisted at discover, while a page the sidebar shows stays unmarked', () => {
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    const source = mkdtempSync(join(tmpdir(), 'dai-fern-hidden-src-'));
    mkdirSync(join(source, 'fern', 'pages'), { recursive: true });
    writeFileSync(join(source, 'fern', 'docs.yml'), [
      'instances:', '  - url: acme.docs.buildwithfern.com', 'title: Acme',
      'navigation:', '  - section: Guides', '    contents:',
      '      - page: Shown', '        path: ./pages/shown.mdx',
      '      - page: Hidden', '        path: ./pages/hidden.mdx', '        hidden: true', '',
    ].join('\n'));
    writeFileSync(join(source, 'fern', 'pages', 'shown.mdx'), '---\ntitle: Shown\n---\n\nIn the sidebar.\n');
    writeFileSync(join(source, 'fern', 'pages', 'hidden.mdx'), '---\ntitle: Hidden\n---\n\nPublished, not in the sidebar.\n');
    const workspace = join(mkdtempSync(join(tmpdir(), 'dai-fern-hidden-')), 'ws');
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DAI_|MIGRATION_|FIRECRAWL_|README_)/.test(key))), MIGRATION_WORKSPACE: workspace };
    const cli = (...args: string[]): string => execFileSync(process.execPath, [join(repo, 'node_modules/tsx/dist/cli.mjs'), join(repo, 'packages/migrate-core/src/cli.ts'), ...args], { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    cli('init', '--source', source, '--platform', 'fern', '--target', 'demo-org', '--fidelity', 'exact');
    cli('discover');
    const tree = parse(readFileSync(join(workspace, 'plan', 'tree.yaml'), 'utf8')) as { pages: Array<{ title: string; navMembership?: string }> };
    expect(tree.pages.find((page) => page.title === 'Hidden')?.navMembership).toBe('unlisted');
    expect(tree.pages.find((page) => page.title === 'Shown')?.navMembership).toBeUndefined();
    // shown in the sidebar by a person's decision, which is recorded on the tree as read: no derived routes enter the reviewed file
    cli('approve', '--gate', '1', '--by', 'reviewer');
    for (const stage of ['acquire', 'inventory', 'plan']) cli(stage);
    cli('approve', '--gate', '2', '--by', 'reviewer');
    cli('assets', '--provider', 'local'); cli('convert'); cli('convert');
    cli('nav', '--place-unlisted', '--by', 'reviewer');
    const placed = readFileSync(join(workspace, 'plan', 'tree.yaml'), 'utf8');
    expect(placed).toMatch(/unlistedPlacement:[\s\S]*approvedBy: reviewer/);
    expect(placed).not.toMatch(/newPath:/);
  }, 60_000);
});
