/**
 * A Fern API reference section (`- api: …` in docs.yml) and the redirects docs.yml states.
 *
 * Both were dropped: a migrated PrivateGPT site lost its 47 endpoint pages, every automated check
 * passed because nothing knew they existed, and its two redirects answered 404. The section is now
 * a navigation group the platform fills from the same spec, and every address Fern served an
 * endpoint at redirects to the page the platform makes for it (checked against PrivateGPT's and
 * Cohere's live sitemaps: every endpoint address reproduced).
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFernRepo } from '../src/adapters/fern.js';
import { platformEndpointPath } from '../src/adapters/fern-api.js';
import { buildDocumentationNavigation, type SourceNavigationNode } from '../src/nav/tree.js';

const write = (root: string, file: string, body: string): void => { mkdirSync(join(root, dirname(file)), { recursive: true }); writeFileSync(join(root, file), body); };
function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dai-fern-api-'));
  for (const [file, body] of Object.entries(files)) write(root, file, body);
  return root;
}
const page = (title: string): string => `---\ntitle: ${title}\n---\n\n${title} body.\n`;

const SPEC = JSON.stringify({
  openapi: '3.0.0', info: { title: 'Acme', version: '1' },
  paths: {
    '/v1/messages': { post: { operationId: 'chat_messages_v1_messages_post', tags: ['Messages'] } },
    '/v1/embeddings': { post: { operationId: 'embeddings_generation_v1_embeddings_post', tags: ['Embeddings'] } },
    '/v1/files/{file_id}': { head: { operationId: 'head_file_v1_files__file_id__head', tags: ['Files'] }, delete: { operationId: 'delete_file', tags: ['Files'], 'x-fern-ignore': true } },
    '/v1/models': { get: { operationId: 'listModels', 'x-fern-sdk-group-name': 'models', 'x-fern-sdk-method-name': 'list' } },
  },
});

const DOCS = [
  'redirects:',
  '  - source: "/overview/welcome/introduction"', '    destination: "/introduction"',
  '  - source: "/old/:slug*"', '    destination: "/new/:slug*"', '    permanent: false',
  'tabs:', '  guide:', '    display-name: Guide', '    skip-slug: true', '  api-reference:', '    display-name: API Reference', '    skip-slug: true',
  'navigation:',
  '  - tab: guide', '    layout:', '      - page: Introduction', '        path: ./pages/index.mdx',
  '  - tab: api-reference', '    layout:',
  '      - section: Overview', '        skip-slug: true', '        contents:', '          - page: API Reference', '            slug: api-reference/overview', '            path: ./pages/api.mdx',
  '      - api: API Reference',
  '',
].join('\n');

function privateGptLike(): string {
  return repo({
    'fern/docs.yml': DOCS,
    'fern/generators.yml': 'api:\n  specs:\n    - openapi: openapi/openapi.json\n',
    'fern/openapi/openapi.json': SPEC,
    'fern/pages/index.mdx': page('Introduction'),
    'fern/pages/api.mdx': page('API Reference'),
  });
}

describe('Fern API reference sections', () => {
  it('becomes a group the platform fills from the spec, with each endpoint Fern hides hidden there too', () => {
    const fern = readFernRepo(privateGptLike());
    expect(fern.apiSections).toEqual([{ title: 'API Reference', groupPath: ['API Reference', 'API Reference'], spec: 'fern/openapi/openapi.json', hiddenApis: ['DELETE /v1/files/{file_id}'], endpoints: 4 }]);
    expect(fern.missing).toEqual([]);
    const tab = fern.tree.navigation!.find((node) => node.type === 'group' && node.label === 'API Reference') as Extract<SourceNavigationNode, { type: 'group' }>;
    expect(tab.children.at(-1)).toEqual({ type: 'group', label: 'API Reference', children: [], openapi: true });
  });

  it('redirects every address Fern served an endpoint at to the page the platform makes for it', () => {
    const fern = readFernRepo(privateGptLike());
    const endpoints = Object.fromEntries(fern.redirects.exact.filter((rule) => rule.source.startsWith('/api-reference/')).map((rule) => [rule.source, rule.destination]));
    expect(endpoints).toEqual({
      '/api-reference/messages/chat-messages-v-1-messages-post': '/api-reference/post-v1-messages',
      // an operationId that starts with its group names the endpoint by the rest
      '/api-reference/embeddings/generation-v-1-embeddings-post': '/api-reference/post-v1-embeddings',
      '/api-reference/files/head-file-v-1-files-file-id-head': '/api-reference/head-v1-files-file_id',
      // the SDK's own names win over the tag and operationId
      '/api-reference/models/list': '/api-reference/get-v1-models',
    });
    // nothing for the endpoint Fern does not publish, and a written page's address stays the page's
    expect(fern.redirects.exact.some((rule) => rule.destination.includes('delete-'))).toBe(false);
    expect(fern.redirects.exact.some((rule) => rule.source === '/api-reference/overview')).toBe(false);
  });

  it('carries the redirects docs.yml states, wildcards included', () => {
    const fern = readFernRepo(privateGptLike());
    expect(fern.redirects.exact[0]).toEqual({ source: '/overview/welcome/introduction', destination: '/introduction', statusCode: 308 });
    expect(fern.redirects.wildcard).toEqual([{ source: '/old/*', destination: '/new/:splat', statusCode: 307 }]);
  });

  it('writes the group into documentation.json with the spec and the hidden operations, and no pages of its own', () => {
    const fern = readFernRepo(privateGptLike());
    for (const p of fern.tree.pages) p.newPath = p.oldPath!.replace(/^\//, '');
    const { navigation } = buildDocumentationNavigation(fern.tree, new Set(fern.tree.pages.map((p) => p.newPath!)), { openapi: fern.apiSections });
    const tab = (navigation.tabs as Array<Record<string, unknown>>).find((t) => t.tab === 'API Reference')!;
    expect(tab.groups).toEqual([
      { group: 'Overview', pages: [{ title: 'API Reference', path: 'api-reference/overview' }] },
      { group: 'API Reference', openapi: 'api-reference/fern/openapi/openapi.json', 'hidden-apis': ['DELETE /v1/files/{file_id}'] },
    ]);
  });

  it('follows a layout: its sections and the slug it gives an endpoint, a streaming variant included', () => {
    const fern = readFernRepo(repo({
      'fern/docs.yml': ['navigation:', '  - api: Cohere API', '    skip-slug: true', '    layout:',
        '      - section: chat', '        skip-slug: true', '        contents:',
        '          - endpoint: POST /v1/messages', '            slug: chat',
        '          - endpoint: STREAM /v1/messages', '            slug: chat-stream',
        '      - section: Models', '        contents:', '          - GET /v1/models', ''].join('\n'),
      'fern/openapi/openapi.json': SPEC,
    }));
    const endpoints = Object.fromEntries(fern.redirects.exact.map((rule) => [rule.source, rule.destination]));
    expect(endpoints['/chat']).toBe('/api-reference/post-v1-messages');
    expect(endpoints['/chat-stream']).toBe('/api-reference/post-v1-messages');
    expect(endpoints['/models/list']).toBe('/api-reference/get-v1-models');
    // an endpoint the layout does not place keeps Fern's default address
    expect(endpoints['/embeddings/generation-v-1-embeddings-post']).toBe('/api-reference/post-v1-embeddings');
  });

  it('reads the spec of a named API from fern/apis/<name>/', () => {
    const fern = readFernRepo(repo({
      'fern/docs.yml': ['navigation:', '  - api: v2 API', '    api-name: v2', ''].join('\n'),
      'fern/apis/v2/generators.yml': 'api:\n  specs:\n    - openapi: ../../../acme-openapi.yaml\n      overrides: ./overrides.yml\n',
      'fern/apis/v2/overrides.yml': 'paths: {}\n',
      'acme-openapi.yaml': 'openapi: 3.0.0\ninfo: { title: Acme, version: "2" }\npaths:\n  /v2/chat:\n    post:\n      operationId: chat\n',
    }));
    expect(fern.apiSections).toMatchObject([{ title: 'v2 API', spec: 'acme-openapi.yaml', endpoints: 1 }]);
    expect(fern.apiNotes).toEqual(['API reference "v2 API": the overrides in fern/apis/v2/overrides.yml are not applied to the published reference, which shows acme-openapi.yaml as it is']);
  });

  it('says so, and drops nothing silently, when there is no OpenAPI spec to build a section from', () => {
    const fern = readFernRepo(repo({
      'fern/docs.yml': ['navigation:', '  - page: Intro', '    path: ./intro.mdx', '  - api: API Reference', ''].join('\n'),
      'fern/intro.mdx': page('Intro'),
      'fern/definition/api.yml': 'name: api\n',
    }));
    expect(fern.apiSections).toEqual([]);
    expect(fern.missing).toEqual(['API reference "API Reference" (no OpenAPI spec to build it from)']);
    expect(fern.apiNotes[0]).toMatch(/Fern Definition, which Documentation\.AI does not read; export it to OpenAPI/);
  });

  it('names endpoint pages exactly as the platform does', () => {
    expect(platformEndpointPath('GET', '/users/{id}')).toBe('api-reference/get-users-id');
    expect(platformEndpointPath('POST', '/v1/messages/count_tokens')).toBe('api-reference/post-v1-messages-count_tokens');
  });
});
