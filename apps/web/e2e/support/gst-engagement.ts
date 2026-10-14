import { expect, request, type Browser, type Locator, type Page } from '@playwright/test';

/** Shared arrangement for browser flows on one client's GST month. */
export const API = process.env.PW_API_URL ?? 'http://localhost:3001/api/v1';
export const MONTH = '9'; // September: its period has ended, so it can be lodged today.

export interface Arranged {
  engagementId: string;
  entityName: string;
  arn: string;
}

/**
 * A client with a regular GSTIN and a Compliance engagement on it: Manager X
 * leads GST and manages the engagement, Senior Y is on the team.
 */
export async function arrangeGstEngagement(): Promise<Arranged> {
  const api = await request.newContext();
  const token = async (email: string) => {
    const res = await api.post(`${API}/auth/dev-token`, { data: { email } });
    expect(res.ok(), `dev sign-in for ${email}`).toBeTruthy();
    return ((await res.json()) as { accessToken: string }).accessToken;
  };
  const call = async (t: string, method: 'GET' | 'POST' | 'PATCH', path: string, data?: object) => {
    const res = await api.fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${t}` },
      data,
    });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  };

  const mp = await token('mp@dhvaj.in');
  const pa = await token('partner.a@dhvaj.in');
  const employees = (await call(pa, 'GET', '/employees?limit=100')) as {
    items: { id: string; employeeCode: string }[];
  };
  const emp = (code: string) => employees.items.find((e) => e.employeeCode === code)!.id;
  const managerX = emp('EMP005');
  const seniorY = emp('EMP006');

  const n = String(Date.now()).slice(-4);
  const pan = `AAACW${n}K`;
  const entityName = `Playwright Traders ${n} Pvt Ltd`;
  const entity = (await call(pa, 'POST', '/entities', {
    legalName: entityName,
    typeSlug: 'private_limited',
    officeCode: 'NORTH',
    pan,
    registrations: [
      { registrationType: 'gstin', registrationNumber: `19${pan}1Z5`, stateCode: '19' },
    ],
  })) as { id: string };
  const engagement = (await call(pa, 'POST', '/engagements', {
    kind: 'compliance',
    entityId: entity.id,
    status: 'accepted',
    financialYear: '2026-27',
    years: [{ financialYear: '2026-27' }],
    streams: ['gst'],
    streamLeads: { gst: managerX },
  })) as { id: string };
  await call(mp, 'PATCH', `/engagements/${engagement.id}`, {
    engagementManagerEmployeeId: managerX,
  });
  await call(pa, 'POST', `/engagements/${engagement.id}/team`, {
    employeeId: seniorY,
    roleOnEngagement: 'in_charge',
  });
  await api.dispose();
  return { engagementId: engagement.id, entityName, arn: `AA19092${n}12345`.slice(0, 15) };
}

/** A signed-in page for one person (each in its own browser context). */
export async function signIn(browser: Browser, who: 'Manager X' | 'Senior Y'): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(`^${who}`) }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  return page;
}

/** September's Outward section on the GST tab, opened by URL. */
export async function outward(page: Page, engagementId: string): Promise<Locator> {
  await page.goto(`/engagements/${engagementId}?tab=gst&m=${MONTH}`);
  const region = page.getByRole('region', { name: 'Outward', exact: true });
  await expect(region.getByRole('heading', { name: 'GSTR-1' })).toBeVisible();
  return region;
}

export const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.4\n${name}\n`),
});
