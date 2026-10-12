import { NotFoundException } from '@nestjs/common';
import type { AppConfigService } from '../../../config/config.module';
import {
  encodeDrivePath,
  GraphClient,
  GraphRequestError,
  SIMPLE_UPLOAD_MAX_BYTES,
} from '../m365/graph-client';
import { SharePointStorageProvider } from './sharepoint-storage.provider';

const GRAPH = 'https://graph.microsoft.com/v1.0';

function makeConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  const values: Record<string, unknown> = {
    M365_TENANT_ID: 'tenant',
    M365_CLIENT_ID: 'client',
    M365_CLIENT_SECRET: 'secret',
    M365_SITE_URL: 'https://contoso.sharepoint.com/sites/PortalFiles',
    M365_GRAPH_BASE_URL: GRAPH,
    M365_LOGIN_BASE_URL: 'https://login.microsoftonline.com',
    ...overrides,
  };
  return { get: (k: string) => values[k] } as unknown as AppConfigService;
}

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Route fetch calls to handlers by "METHOD url-prefix"; records every call. */
function mockFetch(routes: Array<[string, (call: Call) => Response]>): Call[] {
  const calls: Call[] = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    };
    calls.push(call);
    if (call.url.includes('/oauth2/v2.0/token')) {
      return json({ access_token: 'tok', expires_in: 3600 });
    }
    const route = routes.find(([key]) => {
      const [method, prefix] = key.split(' ');
      return call.method === method && call.url.startsWith(`${GRAPH}${prefix}`);
    });
    if (!route) throw new Error(`unexpected ${call.method} ${call.url}`);
    return route[1](call);
  });
  return calls;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const siteAndDrive: Array<[string, (call: Call) => Response]> = [
  ['GET /sites/contoso.sharepoint.com:/sites/PortalFiles', () => json({ id: 'site-1' })],
  ['GET /sites/site-1/drive', () => json({ id: 'drive-1' })],
];

describe('SharePointStorageProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('refuses to start without the Microsoft 365 connection settings', () => {
    const graph = new GraphClient(makeConfig({ M365_CLIENT_SECRET: undefined }));
    expect(() => new SharePointStorageProvider(graph, 'vault')).toThrow(
      /STORAGE_PROVIDER=sharepoint/,
    );
  });

  it('writes under the root folder, resolving the site from its URL once', async () => {
    const calls = mockFetch([
      ...siteAndDrive,
      ['PUT /drives/drive-1/root:/', () => json({ id: 'item-1', name: 'x' }, 201)],
    ]);
    const storage = new SharePointStorageProvider(new GraphClient(makeConfig()), '/vault/');
    const ref = storage.newReference('eng-1', 'doc-1');
    expect(ref).toMatch(/^eng-1\/doc-1\/[0-9a-f-]{36}$/);

    await storage.write(ref, Buffer.from('hello'), 'text/plain');
    await storage.write(ref, Buffer.from('again'), 'text/plain');

    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts[0]?.url).toBe(`${GRAPH}/drives/drive-1/root:/vault/${ref}:/content`);
    expect(puts[0]?.headers.authorization).toBe('Bearer tok');
    expect(puts[0]?.headers['content-type']).toBe('text/plain');
    // site + drive looked up once, token fetched once
    expect(calls.filter((c) => c.url.includes('/sites/')).length).toBe(2);
    expect(calls.filter((c) => c.url.includes('/token')).length).toBe(1);
  });

  it('uploads large files through a chunked upload session without the bearer token', async () => {
    const big = Buffer.alloc(SIMPLE_UPLOAD_MAX_BYTES + 6 * 1024 * 1024, 7);
    const uploadUrl = 'https://contoso.sharepoint.com/upload/session-1';
    const calls = mockFetch([...siteAndDrive]);
    const routed = jest.mocked(global.fetch).getMockImplementation()!;
    jest.mocked(global.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith(':/createUploadSession')) {
        calls.push({ method: 'POST', url, headers: {}, body: init?.body });
        return json({ uploadUrl });
      }
      if (url === uploadUrl) {
        const headers = init?.headers as Record<string, string>;
        calls.push({ method: 'PUT', url, headers, body: init?.body });
        const done = headers['content-range']!.endsWith(`-${big.length - 1}/${big.length}`);
        return done ? json({ id: 'item-big', name: 'x' }, 201) : json({}, 202);
      }
      return routed(input, init);
    });

    const storage = new SharePointStorageProvider(new GraphClient(makeConfig()), 'vault');
    await storage.write('e/d/big', big, 'application/pdf');

    const chunks = calls.filter((c) => c.url === uploadUrl);
    expect(chunks.length).toBe(Math.ceil(big.length / (5 * 1024 * 1024)));
    expect(chunks[0]?.headers['content-range']).toBe(
      `bytes 0-${5 * 1024 * 1024 - 1}/${big.length}`,
    );
    expect(chunks.every((c) => !c.headers.authorization)).toBe(true);
  });

  it('reads bytes back and maps a missing file to NotFound', async () => {
    mockFetch([
      ...siteAndDrive,
      ['GET /drives/drive-1/root:/vault/e/d/present:', () => new Response('bytes!')],
      ['GET /drives/drive-1/root:/vault/e/d/absent:', () => json({}, 404)],
    ]);
    const storage = new SharePointStorageProvider(new GraphClient(makeConfig()), 'vault');
    expect((await storage.read('e/d/present')).toString()).toBe('bytes!');
    await expect(storage.read('e/d/absent')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('treats deleting an already-absent file as success', async () => {
    mockFetch([
      ...siteAndDrive,
      ['DELETE /drives/drive-1/root:/vault/e/d/gone', () => json({}, 404)],
    ]);
    const storage = new SharePointStorageProvider(new GraphClient(makeConfig()), 'vault');
    await expect(storage.remove('e/d/gone')).resolves.toBeUndefined();
  });

  it('retries throttled calls, honouring Retry-After', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    let attempts = 0;
    mockFetch([
      ...siteAndDrive,
      [
        'GET /drives/drive-1/root:/vault/e/d/f:',
        () =>
          ++attempts < 3
            ? new Response('', { status: 429, headers: { 'retry-after': '1' } })
            : new Response('ok'),
      ],
    ]);
    const storage = new SharePointStorageProvider(new GraphClient(makeConfig()), 'vault');
    const pending = storage.read('e/d/f');
    await jest.advanceTimersByTimeAsync(2_000);
    expect((await pending).toString()).toBe('ok');
    expect(attempts).toBe(3);
    jest.useRealTimers();
  });

  it('surfaces the Graph status on other failures', async () => {
    mockFetch([...siteAndDrive, ['GET /drives/drive-1/root:/vault/e/d/f:', () => json({}, 403)]]);
    const storage = new SharePointStorageProvider(new GraphClient(makeConfig()), 'vault');
    await expect(storage.read('e/d/f')).rejects.toMatchObject({ graphStatus: 403 });
  });

  it('refuses references that could escape the root folder', async () => {
    const storage = new SharePointStorageProvider(new GraphClient(makeConfig()), 'vault');
    await expect(storage.read('../other-site/file')).rejects.toBeInstanceOf(NotFoundException);
    await expect(storage.read('e//d')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uses a pinned drive id without any site lookup', async () => {
    const calls = mockFetch([['GET /drives/pinned/root:/vault/e/d/f:', () => new Response('x')]]);
    const graph = new GraphClient(
      makeConfig({ M365_SITE_URL: undefined, M365_DRIVE_ID: 'pinned' }),
    );
    await new SharePointStorageProvider(graph, 'vault').read('e/d/f');
    expect(calls.some((c) => c.url.includes('/sites/'))).toBe(false);
  });
});

describe('encodeDrivePath', () => {
  it('encodes each segment but keeps folder separators', () => {
    expect(encodeDrivePath('portal/e 1/Report #2.docx')).toBe('portal/e%201/Report%20%232.docx');
  });

  it('rejects traversal and empty paths', () => {
    expect(() => encodeDrivePath('a/../b')).toThrow(GraphRequestError);
    expect(() => encodeDrivePath('')).toThrow(GraphRequestError);
  });
});
