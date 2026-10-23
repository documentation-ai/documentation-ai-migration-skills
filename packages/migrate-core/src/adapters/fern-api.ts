/**
 * A Fern `api:` navigation entry: an API reference section Fern builds from an OpenAPI spec, one
 * page per endpoint. Documentation.AI builds the same pages from the same spec when a navigation
 * group names it (`openapi`), so the section migrates as that group, and every address Fern served
 * an endpoint at redirects to the page the platform makes for it.
 *
 * Where the spec is: `generators.yml` in the API's folder (`fern/`, or `fern/apis/<api-name>/` when
 * a repository holds several), under `api.specs[].openapi`, the older `api.path` or `api:` string,
 * or failing those the `openapi/` folder Fern looks in by default.
 *
 * Where Fern served an endpoint, as checked against live Fern sites: below the section's own slug,
 * each SDK group (`x-fern-sdk-group-name`, else the operation's first tag) made a slug, then the
 * endpoint's name (`x-fern-sdk-method-name`, else its `operationId` with the group's name taken off
 * the front) made a slug; a `layout` places endpoints in sections of its own and may name a slug.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import kebabCase from 'lodash/kebabCase.js';
import { parse as parseYaml } from 'yaml';

/** The methods the platform makes a page for (its deployment step reads these and no others). */
const PAGE_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

export interface FernSlugLevel { urlSlug: string; skip?: boolean }

export interface FernApiEndpoint {
  method: string;
  path: string;
  /** The slug levels below the API section, as Fern adds them; the last is the endpoint's own. */
  slugs: FernSlugLevel[];
  /** Fern does not publish it (`x-fern-ignore`, or an audience the section does not show). */
  hidden: boolean;
}

export interface FernApiSpec {
  /** The spec's path from the repository root, or undefined when none is found. */
  spec?: string;
  /** Why no spec was found, or what of the API is not migrated; said at discovery. */
  notes: string[];
  endpoints: FernApiEndpoint[];
}

type Json = Record<string, unknown>;
const record = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {});

/** Fern's overrides file is merged over the spec: objects key by key, anything else replaced. */
function merged(base: unknown, over: unknown): unknown {
  if (!over || typeof over !== 'object' || Array.isArray(over) || !base || typeof base !== 'object' || Array.isArray(base)) return over === undefined ? base : over;
  const out: Json = { ...(base as Json) };
  for (const [key, value] of Object.entries(over as Json)) out[key] = merged(out[key], value);
  return out;
}

function readSpec(file: string): Json {
  try { return record(parseYaml(readFileSync(file, 'utf8'))); }
  catch (error) { throw new Error(`${file} is not a readable OpenAPI spec: ${(error as Error).message}`); }
}

/** The folder an API is defined in: `fern/apis/<name>/`, the only folder under `fern/apis/`, or `fern/` itself. */
function definitionFolder(fernDir: string, apiName: string | undefined): string | undefined {
  const apis = join(fernDir, 'apis');
  if (apiName) return existsSync(join(apis, apiName)) ? join(apis, apiName) : undefined;
  if (existsSync(apis)) {
    const folders = readdirSync(apis, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    if (folders.length === 1) return join(apis, folders[0].name);
  }
  return fernDir;
}

/** The OpenAPI specs (and their overrides) an API folder's generators.yml names, or the default openapi/ folder holds. */
function specsOf(folder: string): Array<{ spec: string; overrides?: string }> {
  const generators = ['generators.yml', 'generators.yaml'].map((name) => join(folder, name)).find(existsSync);
  const config = generators ? record(parseYaml(readFileSync(generators, 'utf8'))) : {};
  const api = config.api;
  const at = (path: unknown): string | undefined => (typeof path === 'string' && path.trim() ? resolve(folder, path.trim()) : undefined);
  if (typeof api === 'string') return at(api) ? [{ spec: at(api)! }] : [];
  const specs = record(api).specs;
  if (Array.isArray(specs)) {
    return specs.flatMap((entry) => {
      const spec = at(record(entry).openapi);
      const overrides = at(record(entry).overrides);
      return spec ? [{ spec, ...(overrides ? { overrides } : {}) }] : [];
    });
  }
  if (at(record(api).path)) return [{ spec: at(record(api).path)!, ...(at(record(api).overrides) ? { overrides: at(record(api).overrides) } : {}) }];
  if (at(config.openapi)) return [{ spec: at(config.openapi)!, ...(at(config['openapi-overrides']) ? { overrides: at(config['openapi-overrides']) } : {}) }];
  const defaults = join(folder, 'openapi');
  if (!existsSync(defaults)) return [];
  const files = readdirSync(defaults).filter((name) => /\.(?:json|ya?ml)$/i.test(name) && !/overrides/i.test(name)).sort();
  return files.length === 1 ? [{ spec: join(defaults, files[0]) }] : [];
}

/** An endpoint as a layout names it: `POST /v1/users`, or `STREAM /v1/chat` for the streaming variant of the operation at that path. */
function layoutOperation(text: string, operations: ReadonlyMap<string, string[]>): { method: string; path: string } | undefined {
  const match = /^([A-Za-z]+)\s+(\S+)$/.exec(text.trim());
  if (!match) return undefined;
  const method = match[1].toLowerCase(); const path = match[2];
  const methods = operations.get(path) ?? [];
  if (methods.includes(method)) return { method, path };
  // a streaming variant is a second page Fern makes for one operation; here it is that operation's page
  if (method === 'stream' && methods.length) return { method: methods.includes('post') ? 'post' : methods[0], path };
  return undefined;
}

export function readFernApi(root: string, fernDir: string, item: { api?: unknown; 'api-name'?: unknown; layout?: unknown; audiences?: unknown }): FernApiSpec {
  const title = String(item.api);
  const apiName = typeof item['api-name'] === 'string' ? item['api-name'] : undefined;
  const folder = definitionFolder(fernDir, apiName);
  if (!folder) return { notes: [`API reference "${title}": fern/apis/${apiName} does not exist`], endpoints: [] };
  const specs = specsOf(folder);
  const where = relative(root, folder) || '.';
  if (!specs.length) {
    const fernDefinition = existsSync(join(folder, 'definition'));
    return { notes: [`API reference "${title}": no OpenAPI spec in ${where}${fernDefinition ? ' (it is written as a Fern Definition, which Documentation.AI does not read; export it to OpenAPI with "fern export" and migrate that)' : ''}`], endpoints: [] };
  }
  const [{ spec, overrides }] = specs;
  if (!existsSync(spec)) return { notes: [`API reference "${title}": ${relative(root, spec)} is named in ${where}/generators.yml but is not in the repository`], endpoints: [] };
  const notes: string[] = [];
  if (specs.length > 1) notes.push(`API reference "${title}": ${where}/generators.yml names ${specs.length} specs; the section is built from ${relative(root, spec)} and ${specs.slice(1).map((entry) => relative(root, entry.spec)).join(', ')} is not migrated`);
  if (overrides) notes.push(`API reference "${title}": the overrides in ${relative(root, overrides)} are not applied to the published reference, which shows ${relative(root, spec)} as it is`);
  const document = overrides && existsSync(overrides) ? record(merged(readSpec(spec), readSpec(overrides))) : readSpec(spec);
  const audiences = Array.isArray(item.audiences) ? item.audiences.map(String) : undefined;

  const operations = new Map<string, string[]>();
  const defaults = new Map<string, FernApiEndpoint>();
  for (const [path, value] of Object.entries(record(document.paths))) {
    for (const [method, operationValue] of Object.entries(record(value))) {
      if (!PAGE_METHODS.includes(method)) continue;
      const operation = record(operationValue);
      operations.set(path, [...(operations.get(path) ?? []), method]);
      const named = operation['x-fern-sdk-method-name'];
      const groups = ([] as unknown[]).concat(operation['x-fern-sdk-group-name'] ?? (Array.isArray(operation.tags) ? operation.tags.slice(0, 1) : [])).map((group) => kebabCase(String(group))).filter(Boolean);
      let name = typeof named === 'string' ? kebabCase(named) : typeof operation.operationId === 'string' ? kebabCase(operation.operationId) : '';
      const group = groups[groups.length - 1];
      // an operationId written as "<group>_<name>" names the endpoint by its second half
      if (typeof named !== 'string' && group && name.startsWith(`${group}-`)) name = name.slice(group.length + 1);
      const stated = Array.isArray(operation['x-fern-audiences']) ? (operation['x-fern-audiences'] as unknown[]).map(String) : undefined;
      const hidden = operation['x-fern-ignore'] === true || (!!audiences && !!stated && !stated.some((audience) => audiences.includes(audience)));
      defaults.set(`${method} ${path}`, { method: method.toUpperCase(), path, slugs: name ? [...groups.map((urlSlug) => ({ urlSlug })), { urlSlug: name }] : [], hidden });
    }
  }

  // a layout places the endpoints it names in sections of its own, and may give one its own slug
  const placed = new Map<string, FernApiEndpoint>();
  const walk = (entries: unknown, above: FernSlugLevel[]): void => {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (typeof entry === 'string') { place(entry, undefined, above); continue; }
      const node = record(entry);
      if (typeof node.endpoint === 'string') { place(node.endpoint, typeof node.slug === 'string' ? node.slug : undefined, above); continue; }
      if (typeof node.section === 'string') { walk(node.contents, [...above, { urlSlug: typeof node.slug === 'string' ? node.slug : kebabCase(node.section), skip: node['skip-slug'] === true }]); continue; }
      if (node.page !== undefined || node.link !== undefined || node.folder !== undefined || node.changelog !== undefined) continue;
      // a subpackage named by its key, with what it holds below it
      const keys = Object.keys(node);
      if (keys.length === 1) {
        const inner = record(node[keys[0]]);
        walk(inner.contents, [...above, { urlSlug: typeof inner.slug === 'string' ? inner.slug : kebabCase(typeof inner.title === 'string' ? inner.title : keys[0]), skip: inner['skip-slug'] === true }]);
      }
    }
  };
  const place = (text: string, slug: string | undefined, above: FernSlugLevel[]): void => {
    const operation = layoutOperation(text, operations);
    const known = operation && defaults.get(`${operation.method} ${operation.path}`);
    if (!known) return;
    const own = slug ?? known.slugs[known.slugs.length - 1]?.urlSlug;
    if (!own) return;
    const key = `${text.trim().split(/\s+/)[0].toUpperCase()} ${known.path}`;
    placed.set(key, { ...known, slugs: [...above, { urlSlug: own }] });
  };
  walk(item.layout, []);
  const placedOperations = new Set([...placed.values()].map((endpoint) => `${endpoint.method} ${endpoint.path}`));
  const endpoints = [...placed.values(), ...[...defaults.values()].filter((endpoint) => !placedOperations.has(`${endpoint.method} ${endpoint.path}`))];
  const unnamed = endpoints.filter((endpoint) => !endpoint.slugs.length && !endpoint.hidden);
  if (unnamed.length) notes.push(`API reference "${title}": ${unnamed.length} endpoint(s) have no operationId, so the address Fern gave them is not known and gets no redirect (${unnamed.slice(0, 3).map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(', ')})`);
  return { spec: relative(root, spec), notes, endpoints };
}

/** The page the platform makes for an operation of a spec in `api-reference/` (its deployment step's own naming). */
export function platformEndpointPath(method: string, path: string): string {
  const clean = path.replace(/[{}]/g, '').replace(/[^\w\s-]/g, '-').replace(/\/+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `api-reference/${`${method.toLowerCase()}-${clean}`.toLowerCase()}`;
}
