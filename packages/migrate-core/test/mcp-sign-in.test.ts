/**
 * Publishing through the Authoring MCP server needs no API key: whoever migrates into a project
 * already has a Documentation.AI account with access to it, so they sign in the way every MCP host
 * signs in - in the browser. These cases run the real flow (discovery, the client metadata document
 * or self-registration, PKCE, the loopback callback, the token exchange) against a stand-in
 * authorization server that checks what a real one checks, and pin how the project is chosen when
 * an account can reach several.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CALLBACK_PORTS, CLIENT_METADATA_URL, chooseProject, clientMetadataDocument, discoverAuthorization, signInWithBrowser, writableProjects, type AccessibleProject } from '../src/publish/mcp-oauth.js';
import { publishThroughMcp } from '../src/publish/publish.js';

const MCP = 'https://api.example.com/mcp';
const reply = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Loopback ports free right now, so a test never depends on the fixed ones being free on this machine. */
async function freePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(Array.from({ length: count }, () => new Promise<Server>((resolve) => { const server = createServer(); server.listen(0, '127.0.0.1', () => resolve(server)); })));
  const ports = servers.map((server) => (server.address() as AddressInfo).port);
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  return ports;
}
const occupy = (port: number): Promise<Server> => new Promise((resolve) => { const server = createServer(); server.listen(port, '127.0.0.1', () => resolve(server)); });
const release = (server: Server): Promise<unknown> => new Promise((resolve) => server.close(resolve));

/** An authorization server as the MCP specification describes one, holding the checks that matter. */
function authorizationServer(overrides: { registration?: boolean; cimd?: boolean; document?: ReturnType<typeof clientMetadataDocument> } = {}) {
  const seen = { registered: undefined as Record<string, unknown> | undefined, token: undefined as URLSearchParams | undefined };
  let challenge = '';
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://api.example.com/.well-known/oauth-protected-resource/mcp') return reply({ resource: MCP, authorization_servers: ['https://login.example.com'], scopes_supported: ['profile', 'email'] });
    if (url === 'https://login.example.com/.well-known/oauth-authorization-server') return reply({ issuer: 'https://login.example.com', authorization_endpoint: 'https://login.example.com/oauth/authorize', token_endpoint: 'https://login.example.com/oauth/token', ...(overrides.registration === false ? {} : { registration_endpoint: 'https://login.example.com/oauth/register' }), ...(overrides.cimd ? { client_id_metadata_document_supported: true } : {}), code_challenge_methods_supported: ['S256'] });
    if (overrides.document && url === overrides.document.client_id) return reply(overrides.document);
    if (url === 'https://login.example.com/oauth/register') { seen.registered = JSON.parse(init!.body as string) as Record<string, unknown>; return reply({ client_id: 'client-123' }, 201); }
    if (url === 'https://login.example.com/oauth/token') {
      const form = new URLSearchParams(init!.body as string); seen.token = form;
      // PKCE: the verifier sent now must hash to the challenge sent when the sign-in started
      const proves = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === challenge;
      return form.get('code') === 'the-code' && proves ? reply({ access_token: 'token-abc', token_type: 'Bearer', expires_in: 3600 }) : reply({ error: 'invalid_grant' }, 400);
    }
    return reply({}, 404);
  }) as unknown as typeof fetch;
  /** The person's browser: reads the sign-in address, "signs in", and is sent back to the loopback address. */
  const browser = (behaviour: 'approve' | 'wrong-state-then-approve' | 'deny') => async (address: string): Promise<void> => {
    const url = new URL(address); challenge = url.searchParams.get('code_challenge') ?? '';
    const clientId = url.searchParams.get('client_id') ?? '';
    if (clientId.startsWith('https://')) {
      // what Clerk checks before it shows the consent screen: the document at the client id names
      // that same address, lists this exact redirect address, and is a public client
      const document = await (await fetchImpl(clientId)).json() as Record<string, unknown>;
      expect(document.client_id).toBe(clientId);
      expect(document.redirect_uris).toContain(url.searchParams.get('redirect_uri'));
      expect(document.token_endpoint_auth_method).toBe('none');
      expect(document).not.toHaveProperty('client_secret');
    }
    const back = (query: string): Promise<globalThis.Response> => fetch(`${url.searchParams.get('redirect_uri')}?${query}`);
    const state = url.searchParams.get('state');
    if (behaviour === 'wrong-state-then-approve') expect((await back('code=stolen&state=someone-elses')).status).toBe(400);
    void back(behaviour === 'deny' ? `error=access_denied&error_description=The+user+said+no&state=${state}` : `code=the-code&state=${state}`);
  };
  return { fetchImpl, browser, seen, authorizeUrl: () => challenge };
}

describe('signing in to the Authoring MCP server from the command line', () => {
  it('finds where to sign in from the documents the server publishes, and refuses one that is not https', async () => {
    const { fetchImpl } = authorizationServer();
    expect(await discoverAuthorization(MCP, fetchImpl)).toEqual({ resource: MCP, issuer: 'https://login.example.com', authorizationEndpoint: 'https://login.example.com/oauth/authorize', tokenEndpoint: 'https://login.example.com/oauth/token', registrationEndpoint: 'https://login.example.com/oauth/register', clientIdMetadataDocuments: false, scopes: ['profile', 'email'] });
    expect((await discoverAuthorization(MCP, authorizationServer({ cimd: true, registration: false }).fetchImpl)).clientIdMetadataDocuments).toBe(true);
    await expect(discoverAuthorization('http://api.example.com/mcp', fetchImpl)).rejects.toThrow(/not https/);
    const silent = (async () => reply({}, 404)) as unknown as typeof fetch;
    // an API key cannot author through the MCP server, so it is never the way out of a failed sign-in
    const message = await discoverAuthorization(MCP, silent).catch((error: Error) => error.message);
    expect(message).toMatch(/does not say where to sign in/);
    expect(message).not.toContain('DAI_API_KEY');
  });

  it('introduces itself by its metadata document where the server takes one, coming back on the first free port the document lists', async () => {
    const ports = await freePorts(2);
    const document = clientMetadataDocument('https://cli.example.com/oauth/client.json', ports);
    const server = authorizationServer({ cimd: true, registration: false, document });
    const taken = await occupy(ports[0]);
    try {
      const signedIn = await signInWithBrowser({ mcpUrl: MCP, fetchImpl: server.fetchImpl, openBrowser: server.browser('approve'), clientMetadataUrl: document.client_id, callbackPorts: ports });
      expect(signedIn.accessToken).toBe('token-abc');
    } finally { await release(taken); }
    expect(server.seen.registered).toBeUndefined();
    expect(server.seen.token!.get('client_id')).toBe(document.client_id);
    expect(server.seen.token!.get('redirect_uri')).toBe(`http://127.0.0.1:${ports[1]}/callback`);
    expect(server.seen.token!.has('client_secret')).toBe(false);
  });

  it('takes the metadata document over self-registration when the server offers both, and is known by the address documentation.ai serves', async () => {
    const ports = await freePorts(1);
    const server = authorizationServer({ cimd: true, document: clientMetadataDocument(CLIENT_METADATA_URL, ports) });
    await signInWithBrowser({ mcpUrl: MCP, fetchImpl: server.fetchImpl, openBrowser: server.browser('approve'), callbackPorts: ports });
    expect(server.seen.registered).toBeUndefined();
    expect(server.seen.token!.get('client_id')).toBe(CLIENT_METADATA_URL);
  });

  it('says so when every port the document lists is taken, rather than coming back on one the server would refuse', async () => {
    const ports = await freePorts(2);
    const server = authorizationServer({ cimd: true, registration: false, document: clientMetadataDocument(CLIENT_METADATA_URL, ports) });
    const taken = await Promise.all(ports.map(occupy));
    try {
      await expect(signInWithBrowser({ mcpUrl: MCP, fetchImpl: server.fetchImpl, openBrowser: server.browser('approve'), callbackPorts: ports })).rejects.toThrow(new RegExp(`ports ${ports.join(', ')} on this machine are all in use`));
    } finally { await Promise.all(taken.map(release)); }
  });

  it('describes itself the way Clerk requires: its own address, a name, a public client, and exact loopback addresses', () => {
    // documentation-ai-website serves this at CLIENT_METADATA_URL; a change here is a change there
    expect(clientMetadataDocument()).toEqual({
      client_id: 'https://documentation.ai/oauth/migrator.json',
      client_name: 'Documentation.AI migrator',
      client_uri: 'https://documentation.ai',
      redirect_uris: ['http://127.0.0.1:38417/callback', 'http://127.0.0.1:38418/callback', 'http://127.0.0.1:38419/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
    });
    expect(CLIENT_METADATA_URL).toMatch(/^https:\/\/[^/]+\/.+/);
    expect(clientMetadataDocument().redirect_uris).toEqual(CALLBACK_PORTS.map((port) => `http://127.0.0.1:${port}/callback`));
  });

  it('registers itself, proves the exchange with PKCE, and takes the code only from the sign-in it started', async () => {
    const server = authorizationServer();
    const lines: string[] = [];
    const signedIn = await signInWithBrowser({ mcpUrl: MCP, fetchImpl: server.fetchImpl, openBrowser: server.browser('wrong-state-then-approve'), log: (line) => lines.push(line) });
    expect(signedIn).toEqual({ accessToken: 'token-abc', expiresInSeconds: 3600 });
    // a public client on a loopback address, asking for the MCP server by name
    expect(server.seen.registered).toMatchObject({ token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], scope: 'profile email' });
    expect((server.seen.registered!.redirect_uris as string[])[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(server.seen.token!.get('resource')).toBe(MCP);
    expect(server.seen.token!.get('client_id')).toBe('client-123');
    // the address is printed as well as opened, for a browser that did not start
    expect(lines.join('\n')).toContain('https://login.example.com/oauth/authorize?');
    // nothing about the token is ever logged
    expect(lines.join('\n')).not.toContain('token-abc');
  });

  it('says what happened when the person declines, and what to do when the server takes no client this version knows', async () => {
    const declined = authorizationServer();
    await expect(signInWithBrowser({ mcpUrl: MCP, fetchImpl: declined.fetchImpl, openBrowser: declined.browser('deny') })).rejects.toThrow(/sign-in was refused: The user said no/);
    const closed = authorizationServer({ registration: false });
    const message = await signInWithBrowser({ mcpUrl: MCP, fetchImpl: closed.fetchImpl, openBrowser: closed.browser('approve') }).catch((error: Error) => error.message);
    expect(message).toMatch(/cannot sign in\. Update the plugin/);
    expect(message).not.toContain('DAI_API_KEY');
  });
});

describe('which project a signed-in person publishes into', () => {
  const listing = { projects: [
    { organizationId: 'org-1', organizationName: 'Acme', role: 'admin', documentation: [{ documentationId: 'doc-1', name: 'Acme Docs' }, { documentationId: 'doc-2', name: 'Acme API' }] },
    { organizationId: 'org-2', organizationName: 'Partner', role: 'viewer', documentation: [{ documentationId: 'doc-3', name: 'Partner Docs' }] },
  ] };
  const projects = writableProjects(listing);

  it('offers only projects the account can change', () => {
    expect(projects.map((project: AccessibleProject) => project.name)).toEqual(['Acme Docs', 'Acme API']);
  });

  it('takes the one named, then the one this migration went into before, then the only one there is', () => {
    expect(chooseProject(projects, 'acme api').documentationId).toBe('doc-2');
    expect(chooseProject(projects, 'doc-1').name).toBe('Acme Docs');
    expect(chooseProject(projects, undefined, 'doc-2').name).toBe('Acme API');
    expect(chooseProject(projects.slice(0, 1)).documentationId).toBe('doc-1');
  });

  it('refuses to guess between several, naming them, and says so when there is nothing to publish into', () => {
    expect(() => chooseProject(projects)).toThrow(/can edit 2 projects.*--project.*"Acme Docs" in Acme \(doc-1\).*"Acme API" in Acme \(doc-2\)/);
    expect(() => chooseProject(projects, 'Partner Docs')).toThrow(/no project named "Partner Docs" that this account can edit/);
    expect(() => chooseProject([])).toThrow(/can edit no Documentation.AI project/);
  });

  it('names the project on every call, so a selection made in another conversation cannot redirect the publish', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dai-mcp-project-'));
    for (const [path, content] of Object.entries({ 'documentation.json': JSON.stringify({ name: 'Acme', navigation: { pages: [{ title: 'A', path: 'a' }] } }), 'a.mdx': '---\ntitle: A\n---\n\nA.\n' })) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), content); }
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const client = { call: async (tool: string, args: Record<string, unknown>) => {
      calls.push({ tool, args });
      const structured = tool === 'list_pages' ? { pages: [] } : tool === 'get_site_config' ? { config: { navigation: { pages: [] } } } : tool === 'publish' ? { status: 'published', commitSha: 'abc' } : {};
      return { structured, text: '' } as never;
    } };
    await publishThroughMcp({ client, outputDir: dir, branch: 'migration/mig-9', commitMessage: 'm', project: { organizationId: 'org-1', documentationId: 'doc-2' } });
    expect(calls.length).toBeGreaterThan(4);
    for (const entry of calls) expect(entry.args, entry.tool).toMatchObject({ organizationId: 'org-1', documentationId: 'doc-2' });
  });
});
