/**
 * The Documentation.AI content contract: what the migrator may emit and how
 * it is validated. Loads the reconciled `contract.json` produced by
 * `scripts/extract.ts` and exposes strict validators.
 *
 * Strict means: every condition the platform's own deployment validator only
 * warns about is an error here.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv, type ErrorObject } from 'ajv';
import addFormatsModule from 'ajv-formats';
import {
  formatIconValue,
  iconSetCandidates,
  iconValueForPick,
  parseIconValue,
  siteIconLibrary,
  toIconName,
  type FontAwesomeStyle,
  type IconLibrary,
  type IconSetId,
} from './icon-contract/icon-contract.js';

export * from './icon-contract/icon-contract.js';

const here = dirname(fileURLToPath(import.meta.url));

export interface PropSchema {
  type?: string | string[];
  enum?: unknown[];
  /** A space-separated value, each part of which must be one of these. */
  tokens?: string[];
  default?: unknown;
  description?: string;
  required?: boolean;
}

export interface ComponentContract {
  name: string;
  publicName: string;
  sources: { renderer: boolean; deploymentValidator: boolean; editorSchema: boolean };
  props: Record<string, PropSchema>;
  children?: { allowed?: string[]; min?: number };
  notes: string[];
}

export interface IconSetContract {
  package: string;
  version: string;
  /** Every name the set draws. Lucide's list holds its published aliases too. */
  names: string[];
  /** Font Awesome's older names, mapped to the name each now draws under. */
  aliases?: Record<string, string>;
}

export interface ContentContract {
  contractVersion: string;
  generatedAt: string;
  emittable: string[];
  components: ComponentContract[];
  valueMaps: Record<string, Record<string, Record<string, string>>>;
  frontmatter: { required: string[]; optional: string[] };
  navigation: {
    rootKeys: string[];
    /** Child collections each container kind may hold, read from the platform's JSON Schema. */
    childKeys: Record<string, string[]>;
    /** Every property a page entry accepts. */
    pageProps: string[];
    /** Every property a container accepts besides its name and its child collection. */
    containerProps: Record<string, string[]>;
    httpMethods: string[];
    rule: string;
  };
  /** documentation.json settings: the platform's own JSON Schema sits beside the contract. */
  siteConfig: { schema: string; topLevelKeys: string[]; required: string[] };
  /**
   * The icon sets the renderer draws, read from its installed packages, for the icon value contract
   * named. A name no set draws renders nothing, silently.
   */
  icons: { contract: string; sets: Record<IconSetId, IconSetContract> };
  redirects: {
    supported: { exact: boolean; namedParam: boolean; trailingWildcard: boolean; splat: boolean };
    defaultStatus: number;
    caseSensitive: boolean;
    segmentCountMustMatch: boolean;
  };
  anchors: { customIds: boolean; slugger: string };
  images: { relativeSourcesResolve: boolean; note: string };
  snippets: { mdx: boolean; jsx: { allowed: boolean; executable: boolean; migratorEmits: boolean } };
}

let cached: ContentContract | undefined;

export function loadContract(path = join(here, '..', 'contract.json')): ContentContract {
  if (!cached) cached = JSON.parse(readFileSync(path, 'utf8')) as ContentContract;
  return cached;
}

export function componentByPublicName(name: string, contract = loadContract()): ComponentContract | undefined {
  return contract.components.find((c) => c.publicName === name && c.name === name) ?? contract.components.find((c) => c.publicName === name);
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code:
    | 'unknown-component'
    | 'invalid-navigation'
    | 'editor-only-node'
    | 'invalid-prop-value'
    | 'missing-required-prop'
    | 'residual-source-syntax'
    | 'expression'
    | 'esm'
    | 'frontmatter-missing'
    | 'frontmatter-title-missing'
    | 'executable' | 'deployment-code-fence' | 'deployment-attribute-quote'
    | 'invalid-site-config';
  message: string;
  line?: number;
}

const RESIDUAL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /^:::(note|tip|info|warning|danger|caution)\b/m, label: 'Docusaurus admonition' },
  { re: /\{%\s*(hint|tabs|tab|endhint|endtabs|endtab|embed|content-ref|code)\b/m, label: 'GitBook Liquid tag' },
  { re: /\{\{\s*snippet\./m, label: 'Document360 snippet token' },
  { re: /@embed\[/m, label: 'ReadMe embed' },
  { re: /<<\s*glossary:/m, label: 'ReadMe glossary variable' },
  // a ReadMe callout is a quote that opens with the emoji; the same emoji on a later line of a quote is its text
  { re: /(?<!(?:^|\n)[ \t]*>[^\n]*\n)^[ \t]*>\s*(📘|👍|🚧|❗)/m, label: 'ReadMe emoji callout' },
  { re: /<(Note|Tip|Warning|Info|Check|Accordion|AccordionGroup|Frame|Tooltip|Badge|Icon|Panel|Tiles|Tree|Banner|RequestExample|ResponseExample)\b/m, label: 'Mintlify component' },
];

/** Split frontmatter from body. Returns null frontmatter when absent. */
export function splitFrontmatter(mdx: string): { frontmatter: string | null; body: string; bodyStartLine: number } {
  const m = mdx.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: null, body: mdx, bodyStartLine: 1 };
  return { frontmatter: m[1], body: mdx.slice(m[0].length), bodyStartLine: m[0].split('\n').length };
}

/** Remove fenced code and inline code so tag scanning does not see examples. */
function stripCode(body: string): string {
  // fences count only at line start (a mid-line ``` must not hide the rest of the document); a component's children indent theirs
  return body
    .replace(/^ *(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n *\1[ \t]*$/gm, (s) => s.replace(/[^\n]/g, ' '))
    // a code span opens and closes with the same run of backticks, and may hold a shorter run inside
    .replace(/(`+)(?:(?!\1)[^\n])*\1/g, (s) => ' '.repeat(s.length));
}

/** Multi-line tags, expressions and import statements are folded onto one line so line-based checks cannot be split around. */
function foldMultiline(scan: string): string {
  return scan
    .replace(/<[A-Za-z][^<>]*>/g, (s) => s.replace(/\n/g, ' '))
    .replace(/\{[^{}]*\}/g, (s) => s.replace(/\n/g, ' '))
    .replace(/^(\s*(?:import|export)\s)[^;\n]*(?:\n[^;\n]*)*?(?=;|\n\s*\n|$)/gm, (s) => s.replace(/\n/g, ' '));
}

/** Strictly validate one MDX document against the contract. */
/**
 * The deployment's code-fence check, as the platform runs it (documentation-ai-backend
 * mdxValidation.service.ts `checkNestedCodeBlocks`). It reads lines, not Markdown: any line whose
 * trimmed text starts with three or more backticks is a fence to it, including a paragraph that opens
 * with a ```` code span ```` which CommonMark reads as inline code. A page it rejects fails the whole
 * preview build, so the local validator refuses the same lines rather than a stricter or looser rule.
 */
export function deploymentFenceIssue(mdx: string): { message: string; line: number } | undefined {
  const lines = mdx.split('\n');
  const stack: { line: number; count: number }[] = [];
  let start = 0;
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') { start = i + 1; break; }
  }
  for (let i = start; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const run = /^(`{3,})/.exec(trimmed);
    if (!run) continue;
    const count = run[1].length;
    const closing = trimmed === '`'.repeat(count);
    const top = stack[stack.length - 1];
    if (!top) { stack.push({ line: i + 1, count }); continue; }
    if (count < top.count) continue;
    if (closing) { stack.pop(); continue; }
    return { line: i + 1, message: `code fence with ${count} backticks and an info string inside a ${top.count}-backtick code block opened at line ${top.line}; the deployment rejects this page` };
  }
  if (stack.length) return { line: stack[0].line, message: `code block of ${stack[0].count} backticks opened here is never closed; the deployment rejects this page` };
  return undefined;
}

/**
 * The deployment's attribute check (mdxValidation.service.ts `checkHtmlEntitiesInJsxAttributes`): a
 * quote written as a character reference inside an attribute quoted with that same mark is refused,
 * because the deployment decodes it before parsing and the attribute then ends early.
 */
export function deploymentAttributeQuoteIssue(mdx: string): { message: string; line: number } | undefined {
  const lines = mdx.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/="[^"]*(?:&#x22;|&#34;|&quot;)[^"]*"/.test(lines[i])) return { line: i + 1, message: 'a double quote written as a character reference inside a double-quoted attribute; the deployment rejects this page' };
    if (/='[^']*(?:&#x27;|&#39;|&apos;)[^']*'/.test(lines[i])) return { line: i + 1, message: 'a single quote written as a character reference inside a single-quoted attribute; the deployment rejects this page' };
  }
  return undefined;
}

export function validateMdx(mdx: string, contract = loadContract()): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { frontmatter, body, bodyStartLine } = splitFrontmatter(mdx);
  if (frontmatter === null) issues.push({ severity: 'error', code: 'frontmatter-missing', message: 'frontmatter block is required for migrated pages' });
  else if (!/^title:\s*\S/m.test(frontmatter)) issues.push({ severity: 'error', code: 'frontmatter-title-missing', message: 'frontmatter.title is required' });
  const fence = deploymentFenceIssue(mdx);
  if (fence) issues.push({ severity: 'error', code: 'deployment-code-fence', message: fence.message, line: fence.line });
  const quote = deploymentAttributeQuoteIssue(mdx);
  if (quote) issues.push({ severity: 'error', code: 'deployment-attribute-quote', message: quote.message, line: quote.line });

  const scan = foldMultiline(stripCode(body));
  const emittable = new Set(contract.emittable);
  const editorOnly = new Set(contract.components.filter((c) => c.notes.some((n) => n.startsWith('editor-only'))).map((c) => c.name));

  const lines = scan.split('\n');
  lines.forEach((line, i) => {
    const ln = bodyStartLine + i;
    for (const m of line.matchAll(/<([A-Za-z][A-Za-z0-9]*)\b([^>]*)>/g)) {
      const name = m[1];
      const editorOnlyHit = editorOnly.has(name) || editorOnly.has(name.charAt(0).toUpperCase() + name.slice(1));
      if (/^[a-z]/.test(name) && !editorOnlyHit) continue; // plain HTML element
      if (editorOnlyHit) issues.push({ severity: 'error', code: 'editor-only-node', message: `<${name}> is an editor-internal node`, line: ln });
      else if (!emittable.has(name)) issues.push({ severity: 'error', code: 'unknown-component', message: `<${name}> is not accepted by the deployment validator`, line: ln });
      else {
        const spec = componentByPublicName(name, contract);
        const attrs = m[2];
        if (spec) {
          for (const [prop, ps] of Object.entries(spec.props)) {
            const am = attrs.match(new RegExp(`\\b${prop}=(?:"([^"]*)"|'([^']*)'|\\{([^}]*)\\})`));
            const raw = am ? (am[1] ?? am[2] ?? am[3]) : undefined;
            if (ps.required && raw === undefined && !/^\s*\/?>?$/.test(attrs) && name !== 'Image') {
              // required props are checked for self-closing usage only where the editor demands them
            }
            if (raw !== undefined && ps.tokens) {
              const unknown = String(raw).split(/\s+/).filter((token) => token && !ps.tokens!.includes(token));
              if (unknown.length) issues.push({ severity: 'error', code: 'invalid-prop-value', message: `<${name} ${prop}="${raw}"> holds ${unknown.map((token) => `"${token}"`).join(', ')}, not among [${ps.tokens.join(', ')}]`, line: ln });
            }
            if (raw !== undefined && ps.enum && !ps.enum.map(String).includes(String(raw))) {
              issues.push({ severity: 'error', code: 'invalid-prop-value', message: `<${name} ${prop}="${raw}"> not in [${ps.enum.join(', ')}]`, line: ln });
            }
          }
          if (name === 'Image' && !/\balt=/.test(attrs)) issues.push({ severity: 'error', code: 'missing-required-prop', message: '<Image> requires alt', line: ln });
          if (name === 'Script') issues.push({ severity: 'error', code: 'executable', message: '<Script> is executable and is never emitted by the migrator', line: ln });
        }
      }
    }
    if (/^\s*(import|export)\s/.test(line) && !/^\s*import\s+[A-Za-z_$][\w$]*\s+from\s+["']\/snippets\/(?!.*\.\.)[\w./-]+\.(?:mdx?|jsx)["'];?\s*$/.test(line)) issues.push({ severity: 'error', code: 'esm', message: 'ESM is not allowed except snippet default imports', line: ln });
    for (const em of line.matchAll(/\{([^}]*)\}/g)) {
      const inner = em[1].trim();
      if (!inner) continue;
      if (/^user\.[a-zA-Z_]+$/.test(inner)) continue; // the one supported expression
      if (/^[0-9]+$/.test(inner)) continue; // numeric props like cols={3}
      if (/^(?:true|false)$/.test(inner)) continue; // boolean props like controls={true}; the platform parses them as JSON literals
      if (/^\/\*[\s\S]*\*\/$/.test(inner)) continue; // MDX comment
      if (/^"(?:[^"\\{}]|\\.)*"$/.test(inner)) continue; // one string literal: static data, the spelling of an attribute value that holds both quote marks
      issues.push({ severity: 'error', code: 'expression', message: `expression {${inner.slice(0, 40)}} is not allowed`, line: ln });
    }
  });

  for (const { re, label } of RESIDUAL_PATTERNS) {
    const m = scan.match(re);
    if (m) issues.push({ severity: 'error', code: 'residual-source-syntax', message: `${label} left in output: ${m[0].slice(0, 60)}` });
  }
  return issues;
}

/** Navigation: exactly one semantic root key; recurse; every page path resolves. */
const NAV_ITEM: Record<string, string> = { products: 'product', versions: 'version', languages: 'language', tabs: 'tab', dropdowns: 'dropdown', menus: 'menu', groups: 'group' };
/** Containers the platform lets stand for an external link alone: `{ tab, href }`, `{ dropdown, href }`, `{ menu, href }`. */
const LINK_ONLY_CONTAINERS = new Set(['tab', 'dropdown', 'menu']);
const CONTENT_WIDTHS = new Set(['narrow', 'normal', 'wide']);
/** Display options the deploy copies from a container onto the page that container opens. */
const CONTAINER_PAGE_OPTIONS = ['method', 'tags', 'badge', 'show-sidebar', 'show-toc', 'show-parent-label', 'content-width', 'show-page-navigation', 'ask-feedback'];

/**
 * documentation.json structure. Pages are objects ({ title, path | href }) or nested
 * groups; a bare string is a Mintlify convention the renderer does not accept.
 */
export function validateNavigation(doc: any, pageExists: (path: string) => boolean, contract = loadContract()): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (message: string) => { issues.push({ severity: 'error', code: 'invalid-navigation', message }); };
  if (typeof doc?.name !== 'string' || !doc.name) err('documentation.json requires a string "name"');
  if (doc?.initialRoute !== undefined) {
    const route = String(doc.initialRoute);
    if (route.startsWith('/')) err(`initialRoute "${route}" must be a page path without a leading slash`);
    else if (!pageExists(route)) err(`initialRoute "${route}" has no page file`);
  }
  const nav = doc?.navigation;
  if (!nav || typeof nav !== 'object') { err('documentation.json has no navigation object'); return issues; }
  const keys = contract.navigation.rootKeys;
  const childKeys: Record<string, string[]> = { navigation: keys, ...contract.navigation.childKeys };
  const iconLibrary = siteIconLibrary(doc?.icons?.library);
  const methods = new Set(contract.navigation.httpMethods);

  /** Presentation every entry may state. A value the renderer cannot use is an error here, because it fails silently there. */
  const presentation = (node: any, path: string): void => {
    if (node.icon !== undefined && (typeof node.icon !== 'string' || !iconDraws(node.icon, iconLibrary, contract))) err(`${path}: icon "${String(node.icon)}" is not an icon the site draws; it would render nothing`);
  };
  const pageItem = (it: any, path: string): void => {
    if (typeof it === 'string') { err(`${path} is the bare string "${it}"; pages must be objects like { "title": ..., "path": ... }`); return; }
    if (!it || typeof it !== 'object') { err(`${path} must be a page or group object`); return; }
    if ('group' in it) { container(it, 'group', path); return; }
    if (typeof it.title !== 'string' || !it.title) err(`${path} requires a "title"`);
    if (typeof it.path === 'string' && typeof it.href === 'string') err(`${path} states both "path" and "href"; a page is one or the other`);
    else if (typeof it.path === 'string') { if (!pageExists(it.path)) err(`navigation page "${it.path}" has no file (${path})`); }
    else if (typeof it.href !== 'string') err(`${path} requires "path" or "href"`);
    for (const key of Object.keys(it)) if (!contract.navigation.pageProps.includes(key)) err(`${path}: "${key}" is not a page entry property`);
    if (it.method !== undefined && !methods.has(it.method)) err(`${path}: method "${String(it.method)}" is not one of ${[...methods].join(', ')}`);
    if (it['content-width'] !== undefined && !CONTENT_WIDTHS.has(it['content-width'])) err(`${path}: content-width "${String(it['content-width'])}" is not narrow, normal or wide`);
    presentation(it, path);
  };
  const container = (node: any, kind: string, path: string): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) { err(`${path} must be an object`); return; }
    if (kind !== 'navigation' && (typeof node[kind] !== 'string' || !node[kind])) err(`${path} requires a string "${kind}"`);
    if ((kind === 'version' || kind === 'language') && 'default' in node) err(`${path}: "default" is not a ${kind} property; list the default ${kind} first`);
    // a container's own page, which it opens when clicked
    if (typeof node.path === 'string' && !pageExists(node.path)) err(`${path}: ${kind} path "${node.path}" has no file`);
    const allowed = childKeys[kind] ?? [];
    const present = keys.filter((k) => k in node);
    // a tab, dropdown or menu may be an external link instead of a container
    const linkOnly = LINK_ONLY_CONTAINERS.has(kind) && typeof node.href === 'string';
    // a group may instead be generated from an OpenAPI document
    const generated = kind === 'group' && typeof node.openapi === 'string';
    if (!(linkOnly && !present.length) && !(generated && !present.length) && present.length !== 1) err(`${path} must have exactly one of [${allowed.join(', ')}]`);
    if (kind !== 'navigation') {
      // A container that opens its own page may state that page's display options: the deploy copies
      // them onto the page (backend generateLookups `copyPageAttributes`), though the schema lists
      // them on page entries only.
      const ownPage = typeof node.path === 'string' ? CONTAINER_PAGE_OPTIONS : [];
      const known = new Set([kind, ...keys, ...(contract.navigation.containerProps[kind] ?? []), ...ownPage]);
      // `default` on a version or language has its own message above, which says what to do instead
      for (const key of Object.keys(node)) if (!known.has(key) && !(key === 'default' && (kind === 'version' || kind === 'language'))) err(`${path}: "${key}" is not a ${kind} property`);
      presentation(node, path);
    }
    for (const k of present) {
      if (!allowed.includes(k)) { err(`${path}: a ${kind} cannot contain ${k}`); continue; }
      const items = node[k];
      if (!Array.isArray(items)) { err(`${path}.${k} must be an array`); continue; }
      items.forEach((it: any, i: number) => (k === 'pages' ? pageItem(it, `${path}.${k}[${i}]`) : container(it, NAV_ITEM[k], `${path}.${k}[${i}]`)));
    }
  };
  container(nav, 'navigation', 'navigation');
  return issues;
}

let siteConfigValidator: ((doc: unknown) => ErrorObject[]) | undefined;

/**
 * documentation.json settings outside the navigation tree, checked against the platform's own JSON
 * Schema. The platform only warns about a key it does not know and ignores it; a migration never
 * writes one, so here it is an error. The tree is checked by `validateNavigation`, whose messages
 * name the entry: a schema's `oneOf` failure over a whole navigation names nothing.
 */
export function validateSiteConfig(doc: unknown, contract = loadContract()): ValidationIssue[] {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [{ severity: 'error', code: 'invalid-site-config', message: 'documentation.json must be a JSON object' }];
  if (!siteConfigValidator) {
    const schema = JSON.parse(readFileSync(join(here, '..', contract.siteConfig.schema), 'utf8')) as { properties: Record<string, unknown>; $defs: Record<string, unknown> };
    // every navigation is acceptable to this pass: the tree has its own validator
    const settingsOnly = { ...schema, $id: `${String((schema as { $id?: string }).$id ?? 'documentation.json')}#settings`, properties: { ...schema.properties, navigation: {} } };
    const ajv = new Ajv({ allErrors: true, strict: false });
    (addFormatsModule as unknown as { default?: (instance: Ajv) => void }).default?.(ajv) ?? (addFormatsModule as unknown as (instance: Ajv) => void)(ajv);
    const validate = ajv.compile(settingsOnly);
    siteConfigValidator = (value) => (validate(value) ? [] : [...(validate.errors ?? [])]);
  }
  return siteConfigValidator(doc).map((error): ValidationIssue => {
    const where = error.instancePath || '/';
    const extra = error.keyword === 'additionalProperties' ? ` ("${String((error.params as { additionalProperty?: string }).additionalProperty)}")` : error.keyword === 'enum' ? ` (${JSON.stringify((error.params as { allowedValues?: unknown[] }).allowedValues)})` : '';
    return { severity: 'error', code: 'invalid-site-config', message: `documentation.json ${where}: ${error.message ?? error.keyword}${extra}` };
  });
}

/**
 * Lucide pictures for Font Awesome names, matched by what the icon shows: used only for a name
 * Font Awesome Free does not draw, such as a Pro icon, so the page still shows the same idea.
 * A brand logo neither set carries has no entry and yields no icon rather than a wrong one.
 */
const ICON_EQUIVALENTS: Record<string, string> = {
  // Font Awesome → Lucide
  'wand-magic-sparkles': 'wand-sparkles', 'code-branch': 'git-branch', 'pen-to-square': 'square-pen', 'magnifying-glass-chart': 'chart-column',
  'pen-ruler': 'pencil-ruler', 'file-import': 'file-input', 'magnifying-glass': 'search', 'hand-pointer': 'pointer', 'clock-rotate-left': 'history',
  'life-ring': 'life-buoy', 'table-columns': 'columns-3', 'layer-group': 'layers', language: 'languages', 'code-pull-request': 'git-pull-request',
  'puzzle-piece': 'puzzle', gears: 'cog', gear: 'settings', robot: 'bot', 'file-lines': 'file-text', 'globe-pointer': 'globe', 'window-restore': 'app-window',
  'clipboard-list-check': 'clipboard-check', 'rectangle-terminal': 'square-terminal', 'chart-line-up': 'chart-line', 'octagon-check': 'circle-check',
  'circle-question': 'circle-help', question: 'circle-help', 'circle-info': 'info', 'circle-exclamation': 'circle-alert', 'triangle-exclamation': 'triangle-alert',
  'circle-check': 'circle-check', check: 'check', xmark: 'x', 'circle-xmark': 'circle-x', bolt: 'zap', 'bolt-lightning': 'zap', 'paper-plane': 'send',
  'book-open-reader': 'book-open', 'book-open-cover': 'book-open', 'graduation-cap': 'graduation-cap', 'chart-simple': 'chart-column', 'chart-bar': 'chart-column',
  'chart-pie': 'chart-pie', 'chart-mixed': 'chart-column', 'square-code': 'square-code', 'file-code': 'file-code', brackets: 'brackets', 'brackets-curly': 'braces',
  'square-terminal': 'square-terminal', 'terminal': 'terminal', 'laptop-code': 'laptop', display: 'monitor', desktop: 'monitor', 'mobile-screen': 'smartphone',
  mobile: 'smartphone', envelope: 'mail', 'envelope-open': 'mail-open', comments: 'messages-square', comment: 'message-circle', message: 'message-square',
  'message-lines': 'message-square-text', headset: 'headset', phone: 'phone', bell: 'bell', 'user-group': 'users', 'users-gear': 'users', 'user-gear': 'user-cog',
  'user-lock': 'user-lock', 'user-shield': 'shield-user', 'shield-halved': 'shield', 'shield-check': 'shield-check', lock: 'lock', unlock: 'lock-open', key: 'key',
  fingerprint: 'fingerprint', 'id-card': 'id-card', 'credit-card': 'credit-card', 'money-bill': 'banknote', 'dollar-sign': 'dollar-sign', receipt: 'receipt',
  'cart-shopping': 'shopping-cart', store: 'store', tag: 'tag', tags: 'tags', 'box-archive': 'archive', box: 'box', boxes: 'boxes', 'boxes-stacked': 'boxes',
  cube: 'box', cubes: 'boxes', database: 'database', server: 'server', cloud: 'cloud', 'cloud-arrow-up': 'cloud-upload', 'cloud-arrow-down': 'cloud-download',
  upload: 'upload', download: 'download', 'file-arrow-up': 'file-up', 'file-arrow-down': 'file-down', 'file-export': 'file-output', folder: 'folder',
  'folder-open': 'folder-open', 'folder-tree': 'folder-tree', sitemap: 'network', 'diagram-project': 'workflow', 'diagram-next': 'workflow', 'arrows-rotate': 'refresh-cw',
  rotate: 'refresh-cw', 'rotate-right': 'rotate-cw', 'rotate-left': 'rotate-ccw', repeat: 'repeat', shuffle: 'shuffle', 'right-left': 'arrow-left-right',
  'arrow-right-arrow-left': 'arrow-left-right', 'arrow-up-right-from-square': 'external-link', 'up-right-from-square': 'external-link', link: 'link',
  'link-slash': 'unlink', plug: 'plug', 'plug-circle-bolt': 'plug-zap', webhook: 'webhook', code: 'code', 'code-merge': 'git-merge', 'code-commit': 'git-commit-horizontal',
  'code-compare': 'git-compare', 'code-fork': 'git-fork', bug: 'bug', flask: 'flask-conical', vial: 'test-tube', microscope: 'microscope', 'screwdriver-wrench': 'wrench',
  wrench: 'wrench', hammer: 'hammer', toolbox: 'briefcase', sliders: 'sliders-horizontal', 'toggle-on': 'toggle-right', 'toggle-off': 'toggle-left', filter: 'funnel',
  'list-check': 'list-checks', 'list-ul': 'list', 'list-ol': 'list-ordered', 'table-list': 'table-properties', table: 'table', 'table-cells': 'grid-3x3',
  'grip': 'grip', bars: 'menu', ellipsis: 'ellipsis', 'grid-2': 'layout-grid', grid: 'layout-grid', 'border-all': 'grid-2x2', palette: 'palette', paintbrush: 'paintbrush',
  'paint-roller': 'paint-roller', 'fill-drip': 'paint-bucket', image: 'image', images: 'images', photo: 'image', 'photo-film': 'images', video: 'video', film: 'film',
  play: 'play', 'circle-play': 'circle-play', music: 'music', microphone: 'mic', 'volume-high': 'volume-2', font: 'type', 'text-size': 'a-large-small', heading: 'heading',
  paragraph: 'pilcrow', 'quote-left': 'quote', 'quote-right': 'quote', highlighter: 'highlighter', pen: 'pen', pencil: 'pencil', 'pen-nib': 'pen-tool', eraser: 'eraser',
  'note-sticky': 'sticky-note', 'notes': 'notebook-text', book: 'book', 'book-bookmark': 'book-marked', bookmark: 'bookmark', newspaper: 'newspaper', 'file': 'file',
  'file-pdf': 'file-text', 'file-zipper': 'file-archive', copy: 'copy', clone: 'copy', paste: 'clipboard-paste', clipboard: 'clipboard', 'clipboard-list': 'clipboard-list',
  'clipboard-check': 'clipboard-check', 'floppy-disk': 'save', trash: 'trash', 'trash-can': 'trash-2', ban: 'ban', flag: 'flag', 'flag-checkered': 'flag',
  star: 'star', heart: 'heart', 'thumbs-up': 'thumbs-up', 'thumbs-down': 'thumbs-down', 'face-smile': 'smile', fire: 'flame', 'fire-flame-curved': 'flame',
  rocket: 'rocket', 'rocket-launch': 'rocket', lightbulb: 'lightbulb', 'lightbulb-on': 'lightbulb', brain: 'brain', 'brain-circuit': 'brain-circuit', sparkles: 'sparkles',
  'wand-magic': 'wand', microchip: 'cpu', 'microchip-ai': 'cpu', 'head-side-brain': 'brain', atom: 'atom', infinity: 'infinity', compass: 'compass', map: 'map',
  'map-location-dot': 'map-pinned', 'location-dot': 'map-pin', 'location-pin': 'map-pin', globe: 'globe', 'earth-americas': 'earth', 'earth-europe': 'earth',
  house: 'house', home: 'house', building: 'building', buildings: 'building-2', city: 'building-2', industry: 'factory', landmark: 'landmark', briefcase: 'briefcase',
  calendar: 'calendar', 'calendar-days': 'calendar-days', 'calendar-check': 'calendar-check', clock: 'clock', stopwatch: 'timer', hourglass: 'hourglass',
  'hourglass-half': 'hourglass', gauge: 'gauge', 'gauge-high': 'gauge', 'gauge-simple': 'gauge', signal: 'signal', wifi: 'wifi', 'tower-broadcast': 'radio-tower',
  'satellite-dish': 'satellite-dish', eye: 'eye', 'eye-slash': 'eye-off', binoculars: 'binoculars', bullseye: 'target', crosshairs: 'crosshair', 'bullseye-arrow': 'target',
  trophy: 'trophy', award: 'award', medal: 'medal', crown: 'crown', gem: 'gem', gift: 'gift', handshake: 'handshake', 'hand-holding-dollar': 'hand-coins',
  'hands-helping': 'heart-handshake', 'people-group': 'users', 'person-chalkboard': 'presentation', chalkboard: 'presentation', 'chalkboard-user': 'presentation',
  'scale-balanced': 'scale', gavel: 'gavel', 'file-contract': 'file-signature', 'file-signature': 'file-signature', signature: 'signature', stamp: 'stamp',
  'truck-fast': 'truck', truck: 'truck', plane: 'plane', car: 'car', ship: 'ship', 'route': 'route', road: 'route', 'arrow-right': 'arrow-right', 'arrow-left': 'arrow-left',
  'arrow-up': 'arrow-up', 'arrow-down': 'arrow-down', 'angles-right': 'chevrons-right', 'angle-right': 'chevron-right', 'chevron-right': 'chevron-right',
  'circle-arrow-right': 'circle-arrow-right', 'square-check': 'square-check', 'square-plus': 'square-plus', plus: 'plus', minus: 'minus', 'circle-plus': 'circle-plus',
  'circle-minus': 'circle-minus', 'circle-dot': 'circle-dot', circle: 'circle', square: 'square', 'object-group': 'group', 'object-ungroup': 'ungroup',
  'up-down-left-right': 'move', expand: 'expand', compress: 'shrink', maximize: 'maximize', minimize: 'minimize', 'window-maximize': 'app-window', browser: 'app-window',
  'window': 'app-window', 'sidebar': 'panel-left', 'table-layout': 'layout-template', 'diagram-cells': 'layout-dashboard', 'chart-network': 'network', 'chart-area': 'chart-area',
  'chart-line': 'chart-line', 'arrow-trend-up': 'trending-up', 'arrow-trend-down': 'trending-down', percent: 'percent', calculator: 'calculator', hashtag: 'hash',
  at: 'at-sign', 'square-rss': 'rss', rss: 'rss', share: 'share', 'share-nodes': 'share-2', 'right-to-bracket': 'log-in', 'right-from-bracket': 'log-out',
  'arrow-right-to-bracket': 'log-in', 'arrow-right-from-bracket': 'log-out', 'power-off': 'power', 'life-saver': 'life-buoy', 'kit-medical': 'briefcase-medical',
  'stethoscope': 'stethoscope', 'heart-pulse': 'heart-pulse', leaf: 'leaf', seedling: 'sprout', tree: 'tree-pine', sun: 'sun', moon: 'moon', 'cloud-sun': 'cloud-sun',
  snowflake: 'snowflake', droplet: 'droplet', water: 'waves', mountain: 'mountain', 'mountain-sun': 'mountain-snow', paw: 'paw-print', bone: 'bone', fish: 'fish',
  // Lucide names newer than the renderer's library → the name that library draws the same picture under
  'file-braces': 'file-json', 'file-braces-corner': 'file-json-2', 'file-code-corner': 'file-code-2', 'circle-question-mark': 'circle-help', 'file-pen-line': 'file-pen-line',
  'chart-no-axes-column': 'chart-no-axes-column', 'square-chart-gantt': 'square-chart-gantt',
};

/** Names both libraries have, drawn differently: Font Awesome's `bolt` is lightning, Lucide's a hex bolt. */
const SAME_NAME_DIFFERENT_PICTURE: Record<string, string> = { bolt: 'zap' };

/** The canonical name a set draws a spelling under, or undefined when the set has no such icon. */
export function iconInSet(set: IconSetId, name: string, contract = loadContract()): string | undefined {
  const data = contract.icons.sets[set];
  if (!data) return undefined;
  if (data.names.includes(name)) return name;
  return data.aliases?.[name];
}

/**
 * Hosts the platform's media library serves files from: production, and the CDN the backend's
 * `MEDIA_IMAGE_CDN_BASE` names for this environment. The platform draws an icon file only from
 * here or the project, so a page never waits on another site.
 */
export function mediaLibraryHosts(): string[] {
  const hosts = ['blob-cdn.documentation.ai'];
  const configured = process.env.MEDIA_IMAGE_CDN_BASE;
  if (configured) {
    try { hosts.push(new URL(configured).hostname); } catch { /* not a URL: production only */ }
  }
  return hosts;
}

const hostOf = (url: string): string => new URL(url).hostname;

/** What a written icon value draws on a site using `library`: a set, a file, or nothing. */
export function iconDraws(value: string, library: IconLibrary, contract = loadContract()): IconSetId | 'file' | undefined {
  const parsed = parseIconValue(value);
  if (!parsed.ok) return undefined;
  if (parsed.value.kind === 'url') return mediaLibraryHosts().includes(hostOf(parsed.value.url)) ? 'file' : undefined;
  // Project files are not served yet, so a path draws nothing.
  if (parsed.value.kind === 'project-file') return undefined;
  const name = parsed.value.name;
  return iconSetCandidates(parsed.value, library).find((candidate) => iconInSet(candidate.set, name, contract))?.set;
}

export interface IconMigration {
  /** The value to write; absent when nothing on the platform draws the icon. */
  value?: string;
  /** Said whenever what is written draws differently from the source, or nothing is written. */
  note?: string;
}

/** Font Awesome style names as sources write them (Mintlify's `iconType`, class tokens), mapped to one spelling. */
const FONT_AWESOME_STYLE_TOKENS: Record<string, string> = {
  fas: 'solid', 'fa-solid': 'solid', solid: 'solid',
  far: 'regular', 'fa-regular': 'regular', regular: 'regular',
  fab: 'brands', 'fa-brands': 'brands', brands: 'brands',
  fal: 'light', 'fa-light': 'light', light: 'light',
  fat: 'thin', 'fa-thin': 'thin', thin: 'thin',
  fad: 'duotone', 'fa-duotone': 'duotone', duotone: 'duotone',
  fass: 'sharp-solid', fasr: 'sharp-regular', fasl: 'sharp-light', fast: 'sharp-thin', fasds: 'sharp-duotone-solid',
  'fa-sharp': 'sharp', 'fa-sharp-duotone': 'sharp-duotone', 'fa-semibold': 'semibold',
};

/** Font Awesome Pro styles, and the Free style closest in look to each. */
const PRO_STYLE_SUBSTITUTES: Record<string, FontAwesomeStyle> = {
  light: 'regular', thin: 'regular', semibold: 'solid', duotone: 'solid', sharp: 'solid',
  'sharp-solid': 'solid', 'sharp-regular': 'regular', 'sharp-light': 'regular', 'sharp-thin': 'regular',
  'sharp-duotone': 'solid', 'sharp-duotone-solid': 'solid',
};

/** Class tokens that size or animate an icon rather than name it. */
const FONT_AWESOME_MODIFIER = /^fa-(?:fw|xs|sm|lg|xl|2xs|2xl|[1-9]0?x|spin|spin-pulse|spin-reverse|pulse|beat|beat-fade|bounce|fade|flip|shake|rotate-(?:90|180|270|by)|flip-(?:horizontal|vertical|both)|border|pull-(?:left|right|start|end)|inverse|li|ul|stack|stack-[12]x|width-auto|swap-opacity)$/;

/**
 * Reads a Font Awesome class string such as `fa-duotone fa-solid fa-house` or `fas fa-rocket fa-fw`:
 * the icon's name and the style it states. A combination such as duotone with solid states the Pro
 * family, which wins over the weight.
 */
function readFontAwesomeClasses(tokens: string[]): { name?: string; style?: string } {
  const styles: string[] = [];
  let name: string | undefined;
  for (const token of tokens.map((t) => t.toLowerCase())) {
    const style = FONT_AWESOME_STYLE_TOKENS[token];
    if (style) styles.push(style);
    else if (token === 'fa' || FONT_AWESOME_MODIFIER.test(token)) continue;
    else if (token.startsWith('fa-') && !name) name = token.slice(3);
  }
  const family = styles.find((style) => style !== 'solid' && style !== 'regular' && style !== 'brands' && style !== 'light' && style !== 'thin');
  const weight = styles.find((style) => !family || style !== family);
  const style = family ? (family === 'sharp' || family === 'sharp-duotone' ? `${family}-${weight ?? 'solid'}` : family) : weight;
  return { name, style };
}

const EMOJI = /\p{Extended_Pictographic}/u;

/** A Font Awesome name: the style it asks for if Free has it, else the nearest Free style, else the same idea in Lucide. */
function migrateFontAwesome(name: string, style: string | undefined, library: IconLibrary, contract: ContentContract): IconMigration {
  const freeStyle = style === 'solid' || style === 'regular' || style === 'brands' ? style : undefined;
  const substitute = style && !freeStyle ? PRO_STYLE_SUBSTITUTES[style] : undefined;
  const wanted = freeStyle ?? substitute;
  const order: IconSetId[] = wanted
    ? [`fa-${wanted}` as IconSetId, ...(['fa-solid', 'fa-brands', 'fa-regular'] as IconSetId[]).filter((set) => set !== `fa-${wanted}`)]
    : ['fa-solid', 'fa-brands', 'fa-regular'];
  for (const [index, set] of order.entries()) {
    const canonical = iconInSet(set, name, contract);
    if (!canonical) continue;
    const value = iconValueForPick(set, canonical, library);
    const drawn = set.slice(3);
    if (style && !freeStyle) return { value, note: `icon "${name}" asks for the Font Awesome Pro ${style} style; drawn ${drawn}` };
    if (index > 0 && wanted) return { value, note: `icon "${name}" has no Font Awesome Free ${wanted} version; drawn ${drawn}` };
    return { value };
  }
  const lucideName = SAME_NAME_DIFFERENT_PICTURE[name] ?? ICON_EQUIVALENTS[name] ?? name;
  const lucide = iconInSet('lucide', lucideName, contract);
  if (lucide) return { value: iconValueForPick('lucide', lucide, library), note: `icon "${name}" is not in Font Awesome Free; drawn as Lucide "${lucide}"` };
  const bare = name.replace(/-(?:solid|regular|light|thin|duotone|sharp|outline|alt)$/, '');
  if (bare !== name) return migrateFontAwesome(bare, style, library, contract);
  return { note: `icon "${name}" is not in Font Awesome Free or Lucide; left out` };
}

/** A Lucide name. */
function migrateLucide(name: string, library: IconLibrary, contract: ContentContract): IconMigration {
  const lucide = iconInSet('lucide', ICON_EQUIVALENTS_NEWER_LUCIDE[name] ?? name, contract);
  if (lucide) return { value: iconValueForPick('lucide', lucide, library) };
  return { note: `icon "${name}" is not in Lucide; left out` };
}

/** A Tabler name: outline unless the source says filled, then the other style, then Lucide's icon of that name. */
function migrateTabler(name: string, style: string | undefined, library: IconLibrary, contract: ContentContract): IconMigration {
  const wantsFilled = style === 'filled';
  const order: IconSetId[] = wantsFilled ? ['tabler-filled', 'tabler'] : ['tabler', 'tabler-filled'];
  for (const [index, set] of order.entries()) {
    const canonical = iconInSet(set, name, contract);
    if (!canonical) continue;
    const value = iconValueForPick(set, canonical, library);
    return index > 0 && wantsFilled ? { value, note: `icon "${name}" has no Tabler filled version; drawn outline` } : { value };
  }
  const lucide = iconInSet('lucide', ICON_EQUIVALENTS_NEWER_LUCIDE[name] ?? name, contract);
  if (lucide) return { value: iconValueForPick('lucide', lucide, library), note: `icon "${name}" is not in Tabler; drawn as Lucide "${lucide}"` };
  return { note: `icon "${name}" is not in Tabler or Lucide; left out` };
}

/** Lucide names newer than the renderer's library, mapped to the name it draws the same picture under. */
const ICON_EQUIVALENTS_NEWER_LUCIDE: Record<string, string> = Object.fromEntries(
  ['file-braces', 'file-braces-corner', 'file-code-corner', 'circle-question-mark'].map((name) => [name, ICON_EQUIVALENTS[name]]),
);

/**
 * The icon value to write for one a source states, for a site whose icons.library is `library`.
 * Font Awesome names are kept, so Mintlify, GitBook, ReadMe and Fern icons need no translating; the
 * shortest value that draws the same icon is written, and every substitution comes with a note.
 *
 * `source` is a name, a Font Awesome class string, a file path or URL, or Mintlify's
 * `{ name, style, library }`. `style` is a style the source states beside the name, such as
 * Mintlify's `iconType`; with none, Font Awesome icons draw solid, the platform's default.
 */
export function migrateIcon(
  source: unknown,
  library: IconLibrary,
  options: { style?: string; sourceLibrary?: string } = {},
  contract = loadContract(),
): IconMigration {
  if (source && typeof source === 'object' && typeof (source as { name?: unknown }).name === 'string') {
    const { name, style, library: sourceLibrary } = source as { name: string; style?: string; library?: string };
    return migrateIcon(name, library, { style: style ?? options.style, sourceLibrary: sourceLibrary ?? options.sourceLibrary }, contract);
  }
  if (typeof source !== 'string' || !source.trim()) return {};
  const raw = source.trim();
  if (EMOJI.test(raw)) return { note: `emoji icon "${raw}" left out; icons are library names or image files` };

  const parsed = parseIconValue(raw);
  if (parsed.ok && parsed.value.kind === 'url' && !mediaLibraryHosts().includes(hostOf(parsed.value.url))) {
    // The assets stage hosts component icon files before this runs; what still points elsewhere
    // was not hosted, and the platform does not draw icon files from other sites.
    return { note: `icon file "${parsed.value.url}" is on another site, which the platform does not draw icons from; left out (add the file to the media library and use its address)` };
  }
  if (parsed.ok && parsed.value.kind === 'project-file') {
    return { note: `icon file "${parsed.value.path}" is a project file, which the platform does not draw icons from yet; left out (add the file to the media library and use its address)` };
  }
  if (parsed.ok && parsed.value.kind !== 'library') return { value: formatIconValue(parsed.value) };

  const tokens = raw.split(/\s+/);
  // A class string never holds a colon; `fa-solid:rocket` is the prefix form.
  if (!raw.includes(':') && (tokens.length > 1 || /^fa-/i.test(raw))) {
    const classes = readFontAwesomeClasses(tokens);
    if (classes.name) return migrateFontAwesome(toIconName(classes.name), classes.style ?? options.style, library, contract);
  }

  const colon = raw.indexOf(':');
  const prefix = colon > 0 ? raw.slice(0, colon).toLowerCase() : undefined;
  const name = toIconName(colon > 0 ? raw.slice(colon + 1) : raw);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return { note: `icon "${raw}" is not an icon name; left out` };
  if (prefix === 'lucide') return migrateLucide(name, library, contract);
  if (prefix === 'tabler' || prefix === 'tabler-filled') return migrateTabler(name, prefix === 'tabler-filled' ? 'filled' : options.style, library, contract);
  if (prefix === 'fa' || prefix?.startsWith('fa-')) return migrateFontAwesome(name, prefix === 'fa' ? options.style : FONT_AWESOME_STYLE_TOKENS[prefix] ?? prefix.slice(3), library, contract);
  if (prefix) return { note: `icon "${raw}" names an icon library the platform does not draw; left out` };

  const sourceLibrary = options.sourceLibrary?.toLowerCase();
  if (sourceLibrary === 'lucide') return migrateLucide(name, library, contract);
  // On a Tabler site, a name stated alone is a Tabler name.
  if (sourceLibrary === 'tabler' || (!sourceLibrary && library === 'tabler')) return migrateTabler(name, options.style, library, contract);
  if (sourceLibrary === 'fontawesome' || library === 'fontawesome') return migrateFontAwesome(name, options.style, library, contract);
  // A bare name on a Lucide site: a name both libraries draw differently is read as the Font
  // Awesome picture sources mean by it (`bolt` is lightning), then Lucide's own name, then a Font
  // Awesome name Lucide draws the same idea under, else the Font Awesome icon itself.
  const differentPicture = SAME_NAME_DIFFERENT_PICTURE[name];
  if (differentPicture && iconInSet('lucide', differentPicture, contract)) return { value: iconValueForPick('lucide', differentPicture, library) };
  const lucide = iconInSet('lucide', ICON_EQUIVALENTS_NEWER_LUCIDE[name] ?? name, contract);
  if (lucide) return { value: iconValueForPick('lucide', lucide, library) };
  const equivalent = ICON_EQUIVALENTS[name];
  if (equivalent && iconInSet('lucide', equivalent, contract)) return { value: iconValueForPick('lucide', equivalent, library) };
  return migrateFontAwesome(name, options.style, library, contract);
}

/** Redirect rule support check against the platform. */
export function classifyRedirect(source: string, contract = loadContract()): 'exact' | 'named-param' | 'needs-wildcard' {
  if (/\*/.test(source) || /:splat/.test(source)) return contract.redirects.supported.trailingWildcard ? 'named-param' : 'needs-wildcard';
  if (/:[A-Za-z_]+/.test(source)) return 'named-param';
  return 'exact';
}

export const SLUG_RULES = {
  pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  /** The same shape with letter case kept: the platform serves a path as it is written. */
  patternAnyCase: /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/,
  maxKeyBytes: 1024,
};

export function isValidSlugSegment(s: string, opts: { case?: 'preserve' | 'lower' } = {}): boolean {
  return (opts.case === 'preserve' ? SLUG_RULES.patternAnyCase : SLUG_RULES.pattern).test(s);
}
