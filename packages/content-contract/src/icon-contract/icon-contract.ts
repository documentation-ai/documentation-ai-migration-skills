// GENERATED from documentation-ai-backend/packages/icon-contract. Edit it there and run `npm run sync`.
// This copy is checked by its test: any local edit fails it.
// @documentation-ai/icon-contract 1.1.0 contract-sha256:1d800b13998233b82202564ce05316f0799b0c8245f31bfc03426931c500965e fixtures-sha256:57c9fadcc4b0effd0174ece2c6176cac08c22f188d2cee398382d963d12c897c
/**
 * The icon value contract: how an `icon` prop or a navigation `icon` field is
 * read, written and resolved. The backend, the dashboard, the docs renderer
 * and the migrator each carry an identical generated copy of this file.
 *
 * It holds syntax and resolution order only. Which names exist belongs to the
 * icon data, and drawing belongs to each app, so this file imports nothing.
 *
 * Grammar, in the order it is tried:
 * - `/icons/brand.svg`: a file in the project (svg, png or webp)
 * - `https://…`: a file anywhere else
 * - `lucide:rocket`, `tabler:`, `tabler-filled:`, `fa:rocket`, `fa-solid:`, `fa-regular:`, `fa-brands:`: a library, chosen explicitly
 * - `fa-solid fa-rocket`, `fas fa-rocket`, `fa-rocket`: Font Awesome class strings, accepted on read
 * - `rocket`, `ArrowRight`: a name in the site's `icons.library`
 */

export const ICON_CONTRACT_VERSION = '1.1.0';

export type IconLibrary = 'lucide' | 'fontawesome' | 'tabler';

export const ICON_LIBRARIES: readonly IconLibrary[] = [
  'lucide',
  'fontawesome',
  'tabler',
];

/** Existing sites have no `icons` setting and were drawn with Lucide. */
export const DEFAULT_ICON_LIBRARY: IconLibrary = 'lucide';

export type FontAwesomeStyle = 'solid' | 'regular' | 'brands';

/** Outline is Tabler's default and has no style of its own. */
export type TablerStyle = 'filled';

export type IconStyle = FontAwesomeStyle | TablerStyle;

/** One drawable collection of icons. A library has one or more. */
export type IconSetId =
  | 'lucide'
  | 'fa-solid'
  | 'fa-regular'
  | 'fa-brands'
  | 'tabler'
  | 'tabler-filled';

export const ICON_SET_IDS: readonly IconSetId[] = [
  'lucide',
  'fa-solid',
  'fa-regular',
  'fa-brands',
  'tabler',
  'tabler-filled',
];

export const ICON_SET_LIBRARY: Readonly<Record<IconSetId, IconLibrary>> = {
  lucide: 'lucide',
  'fa-solid': 'fontawesome',
  'fa-regular': 'fontawesome',
  'fa-brands': 'fontawesome',
  tabler: 'tabler',
  'tabler-filled': 'tabler',
};

export type CustomIconFormat = 'svg' | 'png' | 'webp';

export interface LibraryIconValue {
  kind: 'library';
  /** `null` when no library was written: the site's `icons.library` decides. */
  library: IconLibrary | null;
  /**
   * `null` lets resolution try the library's styles in order: Font Awesome
   * solid, then brands; Tabler outline, then filled.
   */
  style: IconStyle | null;
  name: string;
}

export interface ProjectFileIconValue {
  kind: 'project-file';
  /** Decoded, rooted at the project, free of `.`/`..` segments. Serving must check containment again. */
  path: string;
  format: CustomIconFormat;
}

export interface UrlIconValue {
  kind: 'url';
  /** Normalised by the URL parser. Its file type is unknown until the file is fetched. */
  url: string;
}

export type IconValue = LibraryIconValue | ProjectFileIconValue | UrlIconValue;

export type IconValueError =
  | 'empty'
  | 'too_long'
  | 'invalid_name'
  | 'unknown_prefix'
  | 'unsupported_style'
  | 'unsupported_scheme'
  | 'insecure_url'
  | 'invalid_url'
  | 'url_credentials'
  | 'unsafe_path'
  | 'unsupported_file_type';

export type IconParseResult =
  | { ok: true; value: IconValue }
  | { ok: false; error: IconValueError; message: string };

export interface IconCandidate {
  set: IconSetId;
  /** True only for the Lucide fallback a bare name gets on a non-Lucide site. */
  legacyFallback: boolean;
}

export const MAX_ICON_VALUE_LENGTH = 2048;

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const FILE_FORMATS = new Map<string, CustomIconFormat>([
  ['svg', 'svg'],
  ['png', 'png'],
  ['webp', 'webp'],
]);

const PREFIXES = new Map<
  string,
  { library: IconLibrary; style: IconStyle | null }
>([
  ['lucide', { library: 'lucide', style: null }],
  ['tabler', { library: 'tabler', style: null }],
  ['tabler-filled', { library: 'tabler', style: 'filled' }],
  ['fa', { library: 'fontawesome', style: null }],
  ['fa-solid', { library: 'fontawesome', style: 'solid' }],
  ['fa-regular', { library: 'fontawesome', style: 'regular' }],
  ['fa-brands', { library: 'fontawesome', style: 'brands' }],
]);

/** Class-string style tokens Font Awesome Free draws. `fa` alone is the Font Awesome 4 form. */
const FREE_STYLE_TOKENS = new Map<string, FontAwesomeStyle | null>([
  ['fa', null],
  ['fa-solid', 'solid'],
  ['fas', 'solid'],
  ['fa-regular', 'regular'],
  ['far', 'regular'],
  ['fa-brands', 'brands'],
  ['fab', 'brands'],
]);

/** Pro-only families and styles. Naming one is explicit, so it is refused rather than swapped. */
const PRO_STYLE_TOKENS = new Set([
  'fa-light',
  'fal',
  'fa-thin',
  'fat',
  'fa-duotone',
  'fad',
  'fa-sharp',
  'fass',
  'fasr',
  'fasl',
  'fast',
  'fa-sharp-duotone',
  'fasds',
  'fa-semibold',
  'fa-jelly',
  'fa-chisel',
  'fa-etch',
  'fa-graphite',
  'fa-notdog',
  'fa-slab',
  'fa-thumbprint',
  'fa-whiteboard',
  'fa-utility',
]);

const SCHEMES_THAT_ARE_NOT_ICONS = new Set([
  'data',
  'javascript',
  'vbscript',
  'blob',
  'file',
  'about',
]);

const SET_PREFIX: Readonly<Record<IconSetId, string>> = {
  lucide: 'lucide',
  'fa-solid': 'fa-solid',
  'fa-regular': 'fa-regular',
  'fa-brands': 'fa-brands',
  tabler: 'tabler',
  'tabler-filled': 'tabler-filled',
};

const DEFAULT_SET: Readonly<Record<IconLibrary, IconSetId>> = {
  lucide: 'lucide',
  fontawesome: 'fa-solid',
  tabler: 'tabler',
};

function failure(error: IconValueError, message: string): IconParseResult {
  return { ok: false, error, message };
}

function library(
  libraryName: IconLibrary | null,
  style: IconStyle | null,
  name: string,
): IconParseResult {
  if (!NAME_PATTERN.test(name)) {
    return failure(
      'invalid_name',
      `"${name}" is not an icon name. Names are lowercase words joined by hyphens, like "arrow-right".`,
    );
  }
  return {
    ok: true,
    value: { kind: 'library', library: libraryName, style, name },
  };
}

/** `ArrowRight` and `ALargeSmall` become `arrow-right` and `a-large-small`; kebab-case passes through. */
export function toIconName(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function parseProjectFile(raw: string): IconParseResult {
  if (raw.startsWith('//')) {
    return failure(
      'unsafe_path',
      'A value starting with // points at another host. Write the full https:// address instead.',
    );
  }
  if (raw.includes('\\') || raw.includes('?') || raw.includes('#')) {
    return failure(
      'unsafe_path',
      `"${raw}" is not a project file path. Backslashes, queries and fragments are not allowed.`,
    );
  }
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return failure('unsafe_path', `"${raw}" has broken percent-encoding.`);
  }
  if (
    /%[0-9a-f]{2}/i.test(path) ||
    path.includes('\\') ||
    CONTROL_CHARACTERS.test(path)
  ) {
    return failure(
      'unsafe_path',
      `"${raw}" is encoded more than once or contains characters a file path cannot.`,
    );
  }
  const segments = path.slice(1).split('/');
  if (
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    return failure(
      'unsafe_path',
      `"${raw}" must be a plain path from the project root, without empty, "." or ".." parts.`,
    );
  }
  const format = customIconFormatOf(path);
  if (!format) {
    return failure(
      'unsupported_file_type',
      `"${raw}" must be an .svg, .png or .webp file.`,
    );
  }
  return { ok: true, value: { kind: 'project-file', path, format } };
}

function parseUrl(raw: string): IconParseResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return failure('invalid_url', `"${raw}" is not a valid address.`);
  }
  if (url.protocol === 'http:') {
    return failure(
      'insecure_url',
      `"${raw}" uses http. Icons load only over https.`,
    );
  }
  if (url.protocol !== 'https:') {
    return failure(
      'unsupported_scheme',
      `"${raw}" uses ${url.protocol.replace(':', '')}. Icons load only over https.`,
    );
  }
  if (url.username || url.password) {
    return failure(
      'url_credentials',
      'An icon address cannot carry a username or password.',
    );
  }
  if (!url.hostname) {
    return failure('invalid_url', `"${raw}" has no host.`);
  }
  return { ok: true, value: { kind: 'url', url: url.href } };
}

function parseClassString(tokens: string[]): IconParseResult | null {
  const lowered = tokens.map((token) => token.toLowerCase());
  const pro = lowered.find((token) => PRO_STYLE_TOKENS.has(token));
  if (pro) {
    return failure(
      'unsupported_style',
      `"${pro}" is a Font Awesome Pro style. Use fa-solid, fa-regular or fa-brands.`,
    );
  }
  const [first, second] = lowered;
  if (
    lowered.length === 1 &&
    first.startsWith('fa-') &&
    !FREE_STYLE_TOKENS.has(first)
  ) {
    return library('fontawesome', null, first.slice(3));
  }
  const style = FREE_STYLE_TOKENS.get(first);
  if (
    lowered.length === 2 &&
    style !== undefined &&
    second.startsWith('fa-') &&
    !FREE_STYLE_TOKENS.has(second)
  ) {
    return library('fontawesome', style, second.slice(3));
  }
  return null;
}

export function parseIconValue(input: string): IconParseResult {
  const raw = input.trim();
  if (!raw) return failure('empty', 'The icon is empty.');
  if (raw.length > MAX_ICON_VALUE_LENGTH) {
    return failure(
      'too_long',
      `An icon value can be at most ${MAX_ICON_VALUE_LENGTH} characters.`,
    );
  }
  if (CONTROL_CHARACTERS.test(raw)) {
    return failure('invalid_name', 'The icon contains control characters.');
  }
  if (raw.startsWith('/')) return parseProjectFile(raw);
  if (URL_PATTERN.test(raw)) return parseUrl(raw);

  const notAnIcon = () =>
    failure(
      'invalid_name',
      `"${raw}" is not an icon. Write one name, like "rocket" or "fa-solid:rocket".`,
    );
  const tokens = raw.split(/\s+/);
  if (tokens.length > 1) return parseClassString(tokens) ?? notAnIcon();

  const colon = raw.indexOf(':');
  if (colon === -1) {
    if (/^fa-/i.test(raw)) return parseClassString(tokens) ?? notAnIcon();
    return library(null, null, toIconName(raw));
  }

  const prefix = raw.slice(0, colon).toLowerCase();
  const name = toIconName(raw.slice(colon + 1));
  const known = PREFIXES.get(prefix);
  if (known) return library(known.library, known.style, name);
  if (PRO_STYLE_TOKENS.has(prefix)) {
    return failure(
      'unsupported_style',
      `"${prefix}" is a Font Awesome Pro style. Use fa-solid, fa-regular or fa-brands.`,
    );
  }
  if (prefix === 'http' || prefix === 'https') {
    return failure(
      'invalid_url',
      `"${raw}" is not a valid address. Write https://host/path.`,
    );
  }
  if (SCHEMES_THAT_ARE_NOT_ICONS.has(prefix)) {
    return failure(
      'unsupported_scheme',
      `${prefix}: values cannot be icons. Upload the file or link it over https.`,
    );
  }
  return failure(
    'unknown_prefix',
    `"${prefix}" is not an icon library. Use lucide:, tabler:, tabler-filled:, fa:, fa-solid:, fa-regular: or fa-brands:.`,
  );
}

/** The value as the dashboard and the migrator write it. Accepted class strings come out in prefix form. */
export function formatIconValue(value: IconValue): string {
  if (value.kind === 'url') return value.url;
  if (value.kind === 'project-file') return value.path;
  if (value.library === null) return value.name;
  if (value.library === 'lucide') return `lucide:${value.name}`;
  if (value.library === 'tabler')
    return `${value.style ? `tabler-${value.style}` : 'tabler'}:${value.name}`;
  return `${value.style ? `fa-${value.style}` : 'fa'}:${value.name}`;
}

/** Reads `icons.library` leniently: anything unrecognised means the default, as the renderer treats it. */
export function siteIconLibrary(configured: unknown): IconLibrary {
  return ICON_LIBRARIES.includes(configured as IconLibrary)
    ? (configured as IconLibrary)
    : DEFAULT_ICON_LIBRARY;
}

/**
 * The sets to look a library value up in, in order; the first set that has the
 * name draws it. A prefix with a style names exactly one set and never switches.
 */
export function iconSetCandidates(
  value: LibraryIconValue,
  siteLibrary: IconLibrary,
): IconCandidate[] {
  const exact = (set: IconSetId): IconCandidate => ({
    set,
    legacyFallback: false,
  });
  const libraryCandidates = (
    libraryName: IconLibrary,
    style: IconStyle | null,
  ): IconCandidate[] => {
    if (libraryName === 'lucide') return [exact('lucide')];
    if (libraryName === 'tabler') {
      return style
        ? [exact('tabler-filled')]
        : [exact('tabler'), exact('tabler-filled')];
    }
    return style
      ? [exact(`fa-${style as FontAwesomeStyle}`)]
      : [exact('fa-solid'), exact('fa-brands')];
  };
  if (value.library) return libraryCandidates(value.library, value.style);
  if (siteLibrary === 'lucide') return [exact('lucide')];
  return [
    ...libraryCandidates(siteLibrary, null),
    { set: 'lucide', legacyFallback: true },
  ];
}

/** Writes a resolved icon so it keeps drawing the same way whatever `icons.library` later becomes. */
export function pinnedIconValue(set: IconSetId, name: string): string {
  return `${SET_PREFIX[set]}:${name}`;
}

/** What the picker writes: a bare name for the site library's default set, a prefix for anything else. */
export function iconValueForPick(
  set: IconSetId,
  name: string,
  siteLibrary: IconLibrary,
): string {
  return set === DEFAULT_SET[siteLibrary] ? name : pinnedIconValue(set, name);
}

/**
 * The format a file name's extension claims. Trust it only where the bytes
 * were checked against the extension: project files at deploy, and uploads
 * to the media library.
 */
export function customIconFormatOf(path: string): CustomIconFormat | null {
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return null;
  return FILE_FORMATS.get(fileName.slice(dot + 1).toLowerCase()) ?? null;
}

export interface IconContractFixtures {
  version: string;
  parse: Array<{ input: string; expect?: IconValue; error?: IconValueError }>;
  format: Array<{ input: string; expect: string }>;
  candidates: Array<{
    input: string;
    siteLibrary: IconLibrary;
    expect: Array<[IconSetId, boolean]>;
  }>;
  pick: Array<{
    set: IconSetId;
    name: string;
    siteLibrary: IconLibrary;
    expect: string;
  }>;
}

/** Runs the shared fixtures against this copy; every repository's test asserts the list is empty. */
export function iconContractFixtureFailures(
  fixtures: IconContractFixtures,
): string[] {
  const failures: string[] = [];
  const sortKeys = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sortKeys)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, sortKeys(v)]),
          )
        : value;
  const show = (value: unknown) => JSON.stringify(sortKeys(value));
  if (fixtures.version !== ICON_CONTRACT_VERSION) {
    failures.push(
      `fixtures are for ${fixtures.version}, the contract is ${ICON_CONTRACT_VERSION}`,
    );
  }
  for (const { input, expect, error } of fixtures.parse) {
    const result = parseIconValue(input);
    const actual = result.ok ? show(result.value) : `error ${result.error}`;
    const wanted = error ? `error ${error}` : show(expect);
    if (actual !== wanted)
      failures.push(`parse ${show(input)}: expected ${wanted}, got ${actual}`);
  }
  for (const { input, expect } of fixtures.format) {
    const result = parseIconValue(input);
    const actual = result.ok
      ? formatIconValue(result.value)
      : `error ${result.error}`;
    if (actual !== expect)
      failures.push(
        `format ${show(input)}: expected ${show(expect)}, got ${show(actual)}`,
      );
  }
  for (const { input, siteLibrary, expect } of fixtures.candidates) {
    const result = parseIconValue(input);
    const actual =
      result.ok && result.value.kind === 'library'
        ? show(
            iconSetCandidates(result.value, siteLibrary).map((c) => [
              c.set,
              c.legacyFallback,
            ]),
          )
        : 'not a library value';
    if (actual !== show(expect)) {
      failures.push(
        `candidates ${show(input)} on ${siteLibrary}: expected ${show(expect)}, got ${actual}`,
      );
    }
  }
  for (const { set, name, siteLibrary, expect } of fixtures.pick) {
    const actual = iconValueForPick(set, name, siteLibrary);
    if (actual !== expect)
      failures.push(
        `pick ${set}/${name} on ${siteLibrary}: expected ${show(expect)}, got ${show(actual)}`,
      );
  }
  return failures;
}
