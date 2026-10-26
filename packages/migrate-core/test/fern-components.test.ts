/**
 * Fern's components and MDX conventions. A Fern repository read only through the generic rules lost
 * every callout, tab and button to a sanitised fragment, held `<Code src>` back, ran MDX comments as
 * code, and wrote a comment in the middle of a sentence onto the page as placeholder text.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCommentOnlyExpression, markdownToIr } from '../src/ir/from-markdown.js';
import { docToMdx } from '../src/ir/to-dai-mdx.js';
import { RulesEngine, loadMappings } from '../src/components/rules-engine.js';
import { signatureOf } from '../src/components/signature.js';
import { walkBlocks, type ComponentNode } from '../src/ir/types.js';
import { Ledger } from '../src/ledger/dispositions.js';
import { DecisionLog } from '../src/log/decisions.js';
import { ensureWorkspace } from '../src/session/workspace.js';
import { authoredContentSnapshot, fidelityEqual } from '../src/verify/fidelity.js';
import { validateMdx } from '@dai/content-contract';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const files: Record<string, string> = { 'examples/hello.py': 'print("hello")\n', 'snippets/help.mdx': '---\ntitle: ignored\n---\n\nWrite to support.\n' };
const read = (source: string) => markdownToIr(source, { platform: 'fern', file: 'fern/pages/page.mdx', pageId: 'p', title: 'Page', resolveFile: (path) => files[path.replace(/^(\.\.\/)+/, '')] });

function convert(source: string) {
  const w = mkdtempSync(join(tmpdir(), 'dai-fern-components-')); ensureWorkspace(w);
  const engine = new RulesEngine({ platform: 'fern', mappings: loadMappings([join(repoRoot, 'skills/migrate-generic-to-documentation-ai/mappings/fern.yaml'), join(repoRoot, 'skills/migrate-generic-to-documentation-ai/mappings/generic.yaml')]), ledger: new Ledger(w), log: new DecisionLog(w) });
  const doc = read(source);
  const resolved = engine.resolveDoc(doc);
  return { doc, resolved, mdx: docToMdx(resolved) };
}

describe('MDX comments', () => {
  it('are recognised whatever their form', () => {
    expect(isCommentOnlyExpression('/* note */')).toBe(true);
    expect(isCommentOnlyExpression(' /* one */ /* two */ ')).toBe(true);
    expect(isCommentOnlyExpression('// a line\n// another\n')).toBe(true);
    expect(isCommentOnlyExpression('user.name')).toBe(false);
    expect(isCommentOnlyExpression('/* note */ value')).toBe(false);
  });

  it('are kept as written, on their own line and mid-sentence, never run or written as placeholders', () => {
    const { mdx, doc, resolved } = convert('{/* TODO: refresh */}\n\nShip {/* faster? */} reliable APIs.\n\n<Note>\n{/* inside */}\nRead this.\n</Note>\n');
    expect(mdx).not.toMatch(/UNSUPPORTED|QUARANTINED/);
    for (const comment of ['{/* TODO: refresh */}', '{/* faster? */}', '{/* inside */}']) expect(mdx).toContain(comment);
    expect(mdx).toContain('reliable APIs.');
    expect(mdx).toContain('Read this.');
    expect(validateMdx(mdx).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(fidelityEqual(authoredContentSnapshot(doc), authoredContentSnapshot(resolved))).toBe(true);
  });

  it('keep the tests a docs-as-tests site runs from them: Doc Detective\'s arrive byte for byte and read back the same', () => {
    // the shape of Doc Detective's own Fern pages, whose CI runs these comments as tests
    const source = '{/* test {"testId": "fill-fields"} */}\n\n1. Open the form.\n\n   {/* step {"goTo": "https://example.com/form"} */}\n\n2. Type your first name.\n\n{/* step {"description":"Type in the First Name","find":{"elementText":"First Name"},"type":"Ada"} */}\n\n{/* test end */}\n';
    const { mdx, resolved } = convert(source);
    for (const comment of source.match(/\{\/\*[\s\S]*?\*\/\}/g)!) expect(mdx).toContain(comment);
    // the page the platform serves, read back, says what was migrated: the comments do not count as a difference
    const readBack = markdownToIr(mdx, { platform: 'dai', file: 'page.mdx', pageId: 'p' });
    expect(fidelityEqual(authoredContentSnapshot(resolved), authoredContentSnapshot(readBack))).toBe(true);
  });

  it('turn line comments into the block comments saying the same, which the written page can hold on one line', () => {
    const { mdx } = convert('{// a line\n// another\n}\n\nText.\n');
    expect(mdx).toContain('{/* a line */ /* another */}');
    expect(validateMdx(mdx).filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});

describe('Fern components', () => {
  it('converts each callout to the kind that draws it, with its title as a bold first line', () => {
    const { mdx, doc, resolved } = convert('<Note title="Heads up">\nRead the guide.\n</Note>\n\n<Warning>Careful.</Warning>\n\n<Error>Broken.</Error>\n\n<Check>Done.</Check>\n\n<Callout intent="launch">New.</Callout>\n\n<Callout intent="tip">Hint.</Callout>\n');
    expect([...mdx.matchAll(/<Callout kind="(\w+)">/g)].map((m) => m[1])).toEqual(['info', 'alert', 'danger', 'success', 'info', 'tip']);
    expect(mdx).toMatch(/<Callout kind="info">\s+\*\*Heads up\*\*\s+Read the guide\./);
    // the reader sees the same title, and the fidelity comparison agrees
    expect(fidelityEqual(authoredContentSnapshot(doc), authoredContentSnapshot(resolved))).toBe(true);
    expect(validateMdx(mdx).filter((issue) => issue.severity === 'error').map((issue) => `${issue.code}: ${issue.message}`)).toEqual([]);
  });

  it('reads <Code src>, <Markdown src> and <CodeBlock title> as the content they show', () => {
    const doc = read('<Code src="../../examples/hello.py" />\n\n<CodeBlock title="ping.sh">\n```bash\ncurl x\n```\n</CodeBlock>\n\n<Markdown src="../snippets/help.mdx" />\n');
    expect(doc.children.map((block) => block.type)).toEqual(['code', 'code', 'paragraph']);
    expect(doc.children[0]).toMatchObject({ type: 'code', lang: 'python', meta: 'title="hello.py"', value: 'print("hello")' });
    expect(doc.children[1]).toMatchObject({ type: 'code', lang: 'bash', meta: 'title="ping.sh"' });
    // an included file the repository does not have stays a component, so the plan names it
    expect(read('<Code src="./missing.ts" />\n').children[0]).toMatchObject({ type: 'component', name: 'Code' });
  });

  it('writes a button as the link it opens, alone or in a sentence', () => {
    const { mdx } = convert('<Button href="/docs/start">Get started</Button>\n\nOr <Button href="/docs/api">see the API</Button> first.\n');
    expect(mdx).toContain('[Get started](/docs/start)');
    expect(mdx).toContain('Or [see the API](/docs/api) first.');
  });

  it('reads a button whose label is on lines of its own as that label', () => {
    const { mdx } = convert('<Button intent="primary" href="/docs/start">\n  Start now\n</Button>\n\n<Button intent="primary">\n  Open\n</Button>\n');
    expect(mdx).toContain('[Start now](/docs/start)');
    expect(mdx).toContain('Open');
  });

  it('reads the braces of a display formula as TeX, not MDX', () => {
    const doc = read('$$\n\\f\\relax{x} = \\int_{-\\infty}^\\infty e^{2 \\pi i \\xi x}\n$$\n');
    expect(doc.children).toHaveLength(1);
    expect(JSON.stringify(doc.children[0])).toContain('\\\\int_{-\\\\infty}^\\\\infty e^{2 \\\\pi i \\\\xi x}');
  });

  it('converts tabs, cards, accordions and steps, and keeps nothing as a raw fragment', () => {
    const { mdx } = convert([
      '<Tabs>\n<Tab title="Python" language="python">\nUse pip.\n</Tab>\n<Tab title="Node">\nUse npm.\n</Tab>\n</Tabs>',
      '<CardGroup cols={2}>\n<Card title="SDK" icon="fa-solid fa-code" href="/sdk" iconPosition="left">\nThe SDK.\n</Card>\n</CardGroup>',
      '<AccordionGroup>\n<Accordion title="Install">\nRun it.\n</Accordion>\n</AccordionGroup>',
      '<Expandable title="Key fields reference">\n| Field | Meaning |\n| --- | --- |\n| `model` | Which model answers |\n</Expandable>',
      '<Steps>\n<Step title="One">\nFirst.\n</Step>\n</Steps>',
      'Inline <Icon icon="star" /> star, <Badge>beta</Badge> and <Tooltip tip="Hover text">term</Tooltip>.',
    ].join('\n\n'));
    for (const name of ['Tabs', 'Tab', 'Columns', 'Card', 'ExpandableGroup', 'Expandable', 'Steps', 'Step']) expect(mdx).toContain(`<${name}`);
    expect(mdx).not.toMatch(/data-source-component|UNSUPPORTED|QUARANTINED/);
    expect(mdx).toContain('<abbr title="Hover text">term</abbr>');
  });

  it('converts Fern\'s file tree, prompts, tags, versions, walkthroughs, downloads, anchors and videos to what draws them here', () => {
    const { mdx } = convert([
      '## Release\n\n<ChangelogTags>security, developer-tools</ChangelogTags>',
      '<Files>\n  <Folder name="fern" comment="project root" defaultOpen>\n    <File name="docs.yml" />\n    <File name="guide.mdx" href="/docs/guide" comment="a page" highlighted />\n  </Folder>\n</Files>',
      '<Prompt title="Add a page">\nAdd a page about authentication.\n</Prompt>',
      '<Versions>\n<Version version="v2" title="Version 2" default>\nNew.\n</Version>\n<Version version="v1" title="Version 1">\nOld.\n</Version>\n</Versions>',
      '<ScrollWalkthrough panelHeight="16rem">\n<Step title="Install">\nRun it.\n</Step>\n</ScrollWalkthrough>',
      '<Download src="./assets/guide.pdf">\n  <Button intent="primary">Download PDF</Button>\n</Download>',
      '<Anchor id="endpoints">\n\n| Endpoint |\n| --- |\n| `/plants` |\n\n</Anchor>',
      '<video autoPlay muted loop>\n  <source src="assets/demo.mp4" type="video/mp4" />\n</video>',
      '<embed src="./assets/clip.mp4" type="video/mp4" width="640px" height="360px" />',
      '<div className="highlight-frame">\n<StickyTable>\n\n| Plant |\n| --- |\n| Fern |\n\n</StickyTable>\n</div>',
      '<llms-ignore>\n<a className="fern-card" href="/docs/start">\n  ## Quickstart\n  <Button intent="primary">\n    Start building\n  </Button>\n</a>\n</llms-ignore>',
    ].join('\n\n'));
    expect(mdx).not.toMatch(/data-source-component|UNSUPPORTED|QUARANTINED/);
    expect(mdx).toContain('<span className="dai-mig-badge">security, developer-tools</span>');
    expect(mdx).toMatch(/<ExpandableGroup>[\s\S]*<Expandable title="fern" defaultOpen=\{true\}>[\s\S]*project root[\s\S]*`docs.yml`[\s\S]*\[`guide.mdx`\]\(\/docs\/guide\) a page/);
    expect(mdx).toMatch(/Add a page\s+```text\nAdd a page about authentication\.\n```/);
    expect(mdx).toMatch(/<Tab title="Version 2">[\s\S]*New\.[\s\S]*<Tab title="Version 1">[\s\S]*Old\./);
    expect(mdx).toMatch(/<Steps>[\s\S]*<Step title="Install">/);
    expect(mdx).toContain('[Download PDF](./assets/guide.pdf)');
    expect(mdx).toContain('<a id="endpoints"></a>');
    expect(mdx).toMatch(/<Video src="assets\/demo.mp4"[^>]*autoplay=\{true\}/);
    expect(mdx).toContain('<Video src="./assets/clip.mp4" />');
    // an embedded file that is not a video has no counterpart and is held for a person
    expect(convert('<embed src="./a.pdf" type="application/pdf" />\n').mdx).toMatch(/QUARANTINED/);
    expect(mdx).toContain('| Fern |');
    expect(mdx).toMatch(/## Quickstart\s+\[Start building\]\(\/docs\/start\)/);
    expect(validateMdx(mdx).filter((issue) => issue.severity === 'error').map((issue) => `${issue.code}: ${issue.message}`)).toEqual([]);
  });
});

describe('plan decisions', () => {
  it('reach a component however deeply it is nested, at the depth inventory clustered it', () => {
    const w = mkdtempSync(join(tmpdir(), 'dai-fern-plan-')); ensureWorkspace(w);
    const doc = read('<div className="highlight-frame">\n<div className="highlight-frame-content">\n<llms-only>\nFor agents only.\n</llms-only>\n</div>\n</div>\n\nFor everyone.\n');
    let hash = '';
    walkBlocks(doc.children, (node, depth) => { if (node.type === 'component' && node.name === 'llms-only') hash = signatureOf(node as ComponentNode, depth).hash; });
    expect(hash).not.toBe('');
    const engine = new RulesEngine({ platform: 'fern', mappings: loadMappings([join(repoRoot, 'skills/migrate-generic-to-documentation-ai/mappings/fern.yaml'), join(repoRoot, 'skills/migrate-generic-to-documentation-ai/mappings/generic.yaml')]), ledger: new Ledger(w), log: new DecisionLog(w), plan: { [hash]: { cluster: 'fern/llms-only', tier: 'T7', status: 'excluded', reviewer: 'reviewer', reason: 'agents only' } } });
    const mdx = docToMdx(engine.resolveDoc(doc));
    expect(mdx).not.toContain('For agents only.');
    expect(mdx).not.toMatch(/data-source-component/);
    expect(mdx).toContain('For everyone.');
  });
});
