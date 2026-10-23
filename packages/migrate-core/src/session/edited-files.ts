/**
 * Files and values a person may type: the plan YAML, the inventory JSON a stage asks them to fill
 * in, the files passed with --urls, --headers-file and --cookies-file, and quoted arguments such
 * as `--by "Jane Doe"`.
 *
 * Text that passes through a chat window, a word processor or a web page on its way often comes
 * back with straight quotes turned curly. JSON then failed to parse with a message that named
 * neither the file nor the cause, YAML silently kept the quotes as part of the value (so a status
 * of “excluded” was no decision at all), and a shell split “Jane Doe” in two. These readers
 * name the file, read curly quotes as the straight ones that were meant wherever that is
 * unambiguous, and say exactly what to change where it is not.
 */
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const CURLY_DOUBLE = /[“”„‟″]/g;
const ONE_CURLY_DOUBLE = /[“”„‟″]/;
/** Each opening quote a value may be wrapped in, with the closing quotes that end it (English, German and French styles). */
const CLOSING: Record<string, string> = { '“': '”', '„': '“”', '‘': '’', '‚': '‘’', '«': '»' };

/** A JSON file a person may have edited, with its path in any error and curly quotes read as straight ones. */
export function readEditedJson<T>(path: string): T {
  return parseEditedJson<T>(readFileSync(path, 'utf8'), path);
}

export function parseEditedJson<T>(text: string, path: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const curly = text.match(CURLY_DOUBLE);
    if (curly) {
      // valid JSON never needs a curly quote outside a string, so the straight reading is the meant one
      try { return JSON.parse(text.replace(CURLY_DOUBLE, '"')) as T; } catch { /* a curly quote inside a string as well: say so below */ }
    }
    // named as the cause only where the parser stopped at one: inside a string a curly quote is fine
    const message = (error as Error).message;
    const at = /position (\d+)/.exec(message);
    const blamed = !!curly && (ONE_CURLY_DOUBLE.test(message) || (!!at && ONE_CURLY_DOUBLE.test(text[Number(at[1])] ?? '')));
    const hint = blamed ? `. It has curly quotes (${[...new Set(curly)].join(' ')}) where JSON needs straight ones ("): retype them, or copy the text from a plain-text editor rather than a chat window or a document` : '';
    throw new Error(`${path} is not valid JSON: ${message}${hint}`);
  }
}

/**
 * A YAML file a person may have edited, with its path in any error and values wrapped in curly
 * quotes unwrapped. `keepQuotes` is for a file that carries text copied from the source, such as
 * the tree's page titles, where a title wrapped in curly quotes is the author's own.
 */
export function readEditedYaml<T>(path: string, options: { keepQuotes?: boolean } = {}): T {
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path} is not valid YAML: ${(error as Error).message}`);
  }
  return (options.keepQuotes ? parsed : straightenQuotes(parsed)) as T;
}

/** A value wrapped whole in curly quotes is unwrapped, in every key and string; a quote inside a value is the author's and stays. */
export function straightenQuotes(value: unknown): unknown {
  if (typeof value === 'string') return unwrapQuoted(value);
  if (Array.isArray(value)) return value.map(straightenQuotes);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [unwrapQuoted(key), straightenQuotes(inner)]));
  }
  return value;
}

function unwrapQuoted(text: string): string {
  const trimmed = text.trim();
  const closing = CLOSING[trimmed[0]];
  return closing && trimmed.length > 1 && closing.includes(trimmed[trimmed.length - 1]) ? trimmed.slice(1, -1) : text;
}

/**
 * Command-line arguments as the person meant them. A shell does not treat curly quotes as quotes:
 * --by “Jane Doe” arrives as two words, and only the first was recorded. Words from an opening
 * curly quote to its closing one are joined back into the one value they were.
 */
export function rejoinCurlyQuotedArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const closing = CLOSING[args[i][0]];
    const closes = (word: string, first: boolean): boolean => (!first || word.length > 1) && closing.includes(word[word.length - 1]);
    let end = i;
    while (closing && end < args.length && !closes(args[end], end === i)) end++;
    // not a quoted value, or one never closed: as typed
    if (!closing || end === args.length) { out.push(args[i]); continue; }
    out.push(args.slice(i, end + 1).join(' ').slice(1, -1));
    i = end;
  }
  return out;
}
