/**
 * A landing page is where a migrated site first looks wrong. Its cards sit in a Tailwind grid the
 * migration unwrapped like any other layout div, so they stacked into one long column; their icons
 * are Font Awesome names the platform's Lucide renderer draws nothing for, in silence.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMdx } from '@dai/content-contract';
import { RulesEngine, loadMappings, applyDeclaredLosses } from '../src/components/rules-engine.js';
import { Ledger } from '../src/ledger/dispositions.js';
import { DecisionLog } from '../src/log/decisions.js';
import { ensureWorkspace } from '../src/session/workspace.js';
import { markdownToIr } from '../src/ir/from-markdown.js';
import { docToMdx } from '../src/ir/to-dai-mdx.js';
import { authoredContentSnapshot, fidelityEqual } from '../src/verify/fidelity.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const engineFor = () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dai-landing-')); ensureWorkspace(workspace);
  return new RulesEngine({ platform: 'mintlify', mappings: loadMappings([join(repoRoot, 'skills/migrate-mintlify-to-documentation-ai/mappings/mintlify.yaml'), join(repoRoot, 'skills/migrate-generic-to-documentation-ai/mappings/generic.yaml')]), ledger: new Ledger(workspace), log: new DecisionLog(workspace) });
};

const LANDING = `<div className="relative">
  <div className="px-6 mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
    <Card title="Quickstart" icon="rocket" href="/quickstart">Deploy in minutes</Card>

    <Card title="Settings" icon="gear" href="/settings">Configure the site</Card>

    <Card title="Ask Claude" icon="claude" href="/ai">Use an assistant</Card>
  </div>
</div>
`;

describe('a landing page\'s card grid', () => {
  const engine = engineFor();
  const source = markdownToIr(LANDING, { platform: 'mintlify', file: 'index.mdx', pageId: 'home' });
  const resolved = engine.resolveDoc(source);
  const mdx = docToMdx(resolved);

  it('becomes the platform\'s column layout at the widest count the classes state, and a plain wrapper is still unwrapped', () => {
    expect(mdx).toContain('<Columns cols={3}>');
    expect(mdx).not.toContain('<div');
    expect(mdx.match(/<Card /g)).toHaveLength(3);
    expect(validateMdx(mdx)).toEqual([]);
  });

  it('draws each icon under the name the renderer has for it, and writes none it has nothing for', () => {
    expect(mdx).toContain('<Card title="Quickstart" href="/quickstart" icon="rocket">');
    // Font Awesome's gear is Lucide's settings
    expect(mdx).toContain('icon="settings"');
    // a brand logo Lucide does not carry is drawn from Font Awesome's brands, which has it
    expect(mdx).toContain('<Card title="Ask Claude" href="/ai" icon="fa-brands:claude">');
  });

  it('says nothing the source does not: the comparison the exact gates make still holds', () => {
    const readBack = markdownToIr(mdx, { platform: 'dai', file: 'index.mdx', pageId: 'home' });
    expect(fidelityEqual(authoredContentSnapshot(applyDeclaredLosses(source, engineFor())), authoredContentSnapshot(readBack))).toBe(true);
  });
});

describe('a Mintlify page moved to a Font Awesome site', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dai-landing-fa-')); ensureWorkspace(workspace);
  const ledger = new Ledger(workspace);
  const engine = new RulesEngine({ platform: 'mintlify', mappings: loadMappings([join(repoRoot, 'skills/migrate-mintlify-to-documentation-ai/mappings/mintlify.yaml'), join(repoRoot, 'skills/migrate-generic-to-documentation-ai/mappings/generic.yaml')]), ledger, log: new DecisionLog(workspace), iconLibrary: 'fontawesome' });
  const page = [
    '<Card title="Alerts" icon="bell" iconType="regular" href="/alerts">Get notified</Card>',
    '',
    '<Card title="Launch" icon="rocket" iconType="light" href="/launch">Ship it</Card>',
    '',
    '<Tabs>',
    '  <Tab title="macOS" icon="apple">Install with brew.</Tab>',
    '  <Tab title="Linux" icon="linux">Install with apt.</Tab>',
    '</Tabs>',
    '',
  ].join('\n');
  const mdx = docToMdx(engine.resolveDoc(markdownToIr(page, { platform: 'mintlify', file: 'icons.mdx', pageId: 'icons' })));

  it('keeps each icon\'s name and the style iconType states, as one value', () => {
    expect(mdx).toContain('<Card title="Alerts" href="/alerts" icon="fa-regular:bell">');
    // light is a Pro style; regular has no rocket, so it is drawn solid, the bare name on this site
    expect(mdx).toContain('<Card title="Launch" href="/launch" icon="rocket">');
    expect(validateMdx(mdx)).toEqual([]);
  });

  it('carries tab icons, which were lost before', () => {
    expect(mdx).toContain('<Tab title="macOS" icon="fa-brands:apple">');
    expect(mdx).toContain('<Tab title="Linux" icon="fa-brands:linux">');
  });
});
