import { BadRequestException } from '@nestjs/common';
import { M365Service, ShareLinkCache } from './m365.service';
import type { AppConfigService } from '../../../config/config.module';
import type { DatabaseService } from '../../../database/database.service';
import type { DocumentsService } from '../documents.service';
import type { GraphClient } from './graph-client';
import type { Principal } from '../../auth/principal';

/** Minimal config stub returning values from a plain map (with the schema defaults). */
function makeConfig(overrides: Record<string, unknown>): AppConfigService {
  const values: Record<string, unknown> = {
    M365_ENABLED: false,
    M365_SITE_ID: '',
    M365_DRIVE_ID: '',
    M365_GRAPH_BASE_URL: 'https://graph.microsoft.com/v1.0',
    M365_LOGIN_BASE_URL: 'https://login.microsoftonline.com',
    M365_LINK_EXPIRY_MINUTES: 120,
    M365_ALLOW_ANON_EDIT: false,
    ...overrides,
  };
  return { get: (k: string) => values[k] } as unknown as AppConfigService;
}

const principal = {
  permissions: [],
  userId: 'u1',
  email: 'user@example.com',
  effectiveRole: 'manager',
  officeId: 'o1',
} as unknown as Principal;

describe('M365Service', () => {
  const db = {} as DatabaseService;
  const documents = {} as DocumentsService;

  it('reports supported file types', () => {
    const svc = new M365Service(makeConfig({}), db, documents, {
      configured: true,
    } as GraphClient);
    expect(svc.supports('report.docx')).toBe(true);
    expect(svc.supports('sheet.xlsx')).toBe(true);
    expect(svc.supports('slides.pptx')).toBe(true);
    expect(svc.supports('scan.pdf')).toBe(true);
    expect(svc.supports('archive.zip')).toBe(false);
    expect(svc.supports(null)).toBe(false);
  });

  it('is disabled unless both the flag and Graph config are present', () => {
    expect(
      new M365Service(makeConfig({ M365_ENABLED: false }), db, documents, {
        configured: true,
      } as GraphClient).enabled,
    ).toBe(false);
    expect(
      new M365Service(makeConfig({ M365_ENABLED: true }), db, documents, {
        configured: false,
      } as GraphClient).enabled,
    ).toBe(false);
    expect(
      new M365Service(makeConfig({ M365_ENABLED: true }), db, documents, {
        configured: true,
      } as GraphClient).enabled,
    ).toBe(true);
  });

  it('refuses to build a session when disabled', async () => {
    const svc = new M365Service(makeConfig({ M365_ENABLED: false }), db, documents, {
      configured: false,
    } as GraphClient);
    await expect(svc.buildSession(principal, 'eng1', 'doc1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('ShareLinkCache', () => {
  const MIN = 60_000;

  it('reuses a link while it has more than 15 minutes left, then makes a new one', async () => {
    let now = 0;
    const cache = new ShareLinkCache(() => now);
    let made = 0;
    const create = () => Promise.resolve(`link-${++made}`);
    expect(await cache.get('d:i:edit', 120, create)).toBe('link-1');
    now = 104 * MIN;
    expect(await cache.get('d:i:edit', 120, create)).toBe('link-1');
    now = 106 * MIN;
    expect(await cache.get('d:i:edit', 120, create)).toBe('link-2');
  });

  it('keeps edit and view links apart', async () => {
    const cache = new ShareLinkCache(() => 0);
    let made = 0;
    const create = () => Promise.resolve(`link-${++made}`);
    expect(await cache.get('d:i:edit', 120, create)).toBe('link-1');
    expect(await cache.get('d:i:view', 120, create)).toBe('link-2');
    expect(await cache.get('d:i:edit', 120, create)).toBe('link-1');
  });

  it('shares one Graph call between simultaneous opens', async () => {
    const cache = new ShareLinkCache(() => 0);
    const create = jest.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('one'), 5)),
    );
    const links = await Promise.all([cache.get('k', 120, create), cache.get('k', 120, create)]);
    expect(links).toEqual(['one', 'one']);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failed call, and keeps links with no expiry', async () => {
    const cache = new ShareLinkCache(() => 0);
    await expect(cache.get('k', 0, () => Promise.reject(new Error('refused')))).rejects.toThrow(
      'refused',
    );
    expect(await cache.get('k', 0, () => Promise.resolve('forever'))).toBe('forever');
    expect(await cache.get('k', 0, () => Promise.resolve('other'))).toBe('forever');
  });
});
