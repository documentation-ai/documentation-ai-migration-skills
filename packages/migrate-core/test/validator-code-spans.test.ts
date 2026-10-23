/**
 * The strict validator reads any `{…}` on a prose line as an expression. A code span is not prose,
 * and a span may open with several backticks so it can hold backticks inside; the validator only
 * knew the single-backtick form, so a page explaining fences (```` ``` ````) had its next code span
 * read as prose and its `{variable}` refused — on a page the platform itself compiles fine.
 */
import { describe, it, expect } from 'vitest';
import { validateMdx } from '@dai/content-contract';

const page = (line: string) => `---\ntitle: T\n---\n\n${line}\n`;

describe('code spans in the strict validator', () => {
  it('ignores braces inside a span that opens with several backticks', () => {
    expect(validateMdx(page('Inside fences (```` ``` ````) you can write `{variable}` directly.')).filter((i) => i.code === 'expression')).toEqual([]);
  });
  it('still refuses an expression in prose', () => {
    expect(validateMdx(page('Write {variable} here.')).some((i) => i.code === 'expression')).toBe(true);
  });
  // Doc Detective's pages: 576 refusals on pages the platform compiles, which would have held the release
  it('reads a comment as a comment however many braces its text holds, on one line or several', () => {
    const tests = '{/* step {"stepId":"annotate-add-step","annotate":{"add":[{"id":"guide","callout":"#username-input"}]}} */}\n\n{/* test {\n  "testId": "fill-fields"\n} */}\n\nText.';
    expect(validateMdx(page(tests)).filter((i) => i.code === 'expression')).toEqual([]);
    expect(validateMdx(page('{/* note */} then {variable}')).some((i) => i.code === 'expression')).toBe(true);
  });
  it('reads a fenced block inside a quote as code', () => {
    expect(validateMdx(page('> **Before:**\n>\n> ```json\n> { "timeout": 5000 }\n> ```\n>\n> After.')).filter((i) => i.code === 'expression')).toEqual([]);
  });
});
