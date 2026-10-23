/**
 * Text a person types or pastes. A one-line documentation.json pasted from a chat window came back
 * with curly quotes and failed with a message that named neither the file nor the cause; a YAML
 * decision in curly quotes was silently no decision; `--by “Jane Doe”` recorded "“Jane".
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEditedJson, readEditedYaml, rejoinCurlyQuotedArgs } from '../src/session/edited-files.js';

describe('JSON a person edited', () => {
  it('reads curly quotes where JSON needs straight ones as the straight ones meant', () => {
    expect(parseEditedJson('{“name”: “Acme Docs”, “navigation”: {“pages”: [“index”]}}', 'documentation.json')).toEqual({ name: 'Acme Docs', navigation: { pages: ['index'] } });
  });

  it('keeps a curly quote inside a string, which is the author’s', () => {
    expect(parseEditedJson('{"title": "The “fast” path"}', 'x.json')).toEqual({ title: 'The “fast” path' });
  });

  it('names the file, and blames curly quotes only where the parser stopped at one', () => {
    expect(() => parseEditedJson('{"a": 1,}', 'plan/urls.json')).toThrow(/^plan\/urls\.json is not valid JSON: /);
    expect(() => parseEditedJson('{"a": 1,}', 'plan/urls.json')).not.toThrow(/curly/);
    // a stray curly quote that cannot be read either way
    expect(() => parseEditedJson('{"say": “hi "there"”}', 'inventory/snippets.json')).toThrow(/inventory\/snippets\.json is not valid JSON[\s\S]*curly quotes/);
  });
});

describe('YAML a person edited', () => {
  const file = (text: string): string => { const dir = mkdtempSync(join(tmpdir(), 'dai-edited-')); writeFileSync(join(dir, 'plan.yaml'), text); return join(dir, 'plan.yaml'); };

  it('unwraps a value typed in curly quotes, so a decision is the decision', () => {
    const plan = readEditedYaml<{ components: Array<{ status: string; reviewer: string; note: string }> }>(file('components:\n  - status: “excluded”\n    reviewer: ‘Jane Doe’\n    note: the “old” widget\n'));
    expect(plan.components[0]).toEqual({ status: 'excluded', reviewer: 'Jane Doe', note: 'the “old” widget' });
  });

  it('keeps titles as the source wrote them where asked to', () => {
    expect(readEditedYaml<{ title: string }>(file('title: “Quoted”\n'), { keepQuotes: true }).title).toBe('“Quoted”');
  });

  it('names the file when it does not parse', () => {
    expect(() => readEditedYaml(file('a: [1, 2\n'))).toThrow(/plan\.yaml is not valid YAML/);
  });
});

describe('arguments typed in curly quotes', () => {
  it('joins the words a shell split back into the one value', () => {
    expect(rejoinCurlyQuotedArgs(['approve', '--gate', '1', '--by', '“Jane', 'Doe”'])).toEqual(['approve', '--gate', '1', '--by', 'Jane Doe']);
    expect(rejoinCurlyQuotedArgs(['--reason', '„the', 'preview', 'showed', 'it“', '--by', '“Asha”'])).toEqual(['--reason', 'the preview showed it', '--by', 'Asha']);
  });

  it('leaves everything else as typed', () => {
    expect(rejoinCurlyQuotedArgs(['--by', 'Jane Doe', '--note', 'it’s fine'])).toEqual(['--by', 'Jane Doe', '--note', 'it’s fine']);
    expect(rejoinCurlyQuotedArgs(['--by', '“never', 'closed'])).toEqual(['--by', '“never', 'closed']);
  });
});
