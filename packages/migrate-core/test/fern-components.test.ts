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
});
