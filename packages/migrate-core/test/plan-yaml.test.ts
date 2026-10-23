/**
 * A plan file is written, reviewed, and read back by the next stage. Doc Detective's Fern site put
 * its 210 pages in sections that share one `group` list each; YAML wrote every repeat as an alias,
 * 187 of them, and the reader refused the tree as a resource-exhaustion attack, so the migration
 * stopped at acquire.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTree, writeTree, type Tree } from '../src/nav/tree.js';
import { ensureWorkspace } from '../src/session/workspace.js';

describe('plan files', () => {
  it('read back whole however many pages share a section, with no alias in the file a person reviews', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'dai-plan-yaml-'));
    ensureWorkspace(workspace);
    const group = ['Documentation', 'Get started'];
    const pages = Array.from({ length: 210 }, (_, index) => ({ id: `p${index}`, title: `Page ${index}`, source: `fern/pages/p${index}.mdx`, group, order: index, oldPath: `/docs/p${index}`, migrate: true, reason: 'docs.yml' }));
    writeTree(workspace, { platform: 'fern', pages } as unknown as Tree);
    expect(readFileSync(join(workspace, 'plan', 'tree.yaml'), 'utf8')).not.toMatch(/[&*]a\d+/);
    const tree = readTree(workspace);
    expect(tree.pages).toHaveLength(210);
    expect(tree.pages[209].group).toEqual(group);
  });
});
