import { expect, request, test, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * Spec acceptance: one GST month worked end to end in the browser. A client
 * with a regular GSTIN gets a Compliance engagement; the manager assigns
 * September's GSTR-1, the senior prepares it (uploads into slots, ticks the
 * checklist), sends it for review, the manager approves, and the senior lodges
 * it with an ARN and the acknowledgement. Activity then shows the filing and
 * the time the task ran.
 */
const API = process.env.PW_API_URL ?? 'http://localhost:3001/api/v1';
const MONTH = '9'; // September: its period has ended, so it can be lodged today.

interface Arranged {
  engagementId: string;
  arn: string;
}

async function arrange(): Promise<Arranged> {
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
  const entity = (await call(pa, 'POST', '/entities', {
    legalName: `Playwright Traders ${n} Pvt Ltd`,
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
  return { engagementId: engagement.id, arn: `AA19092${n}12345`.slice(0, 15) };
}

/** A signed-in page for one person (each in its own browser context). */
async function signIn(browser: Browser, who: 'Manager X' | 'Senior Y'): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(`^${who}`) }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  return page;
}

/** One of September's sections on the GST tab. */
async function section(
  page: Page,
  engagementId: string,
  name: 'Outward' | 'Inward',
  heading: string,
): Promise<Locator> {
  await page.goto(`/engagements/${engagementId}?tab=gst&m=${MONTH}`);
  const region = page.getByRole('region', { name, exact: true });
  await expect(region.getByRole('heading', { name: heading })).toBeVisible();
  return region;
}
const outward = (page: Page, engagementId: string) =>
  section(page, engagementId, 'Outward', 'GSTR-1');

const file = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.4\n${name}\n`),
});

test('a GST month: assign, prepare, review, lodge, and see it in Activity', async ({ browser }) => {
  const { engagementId, arn } = await arrange();
  const manager = await signIn(browser, 'Manager X');
  const senior = await signIn(browser, 'Senior Y');

  // The manager assigns the filing: Senior Y prepares, Manager X reviews.
  let m = await outward(manager, engagementId);
  const assign = m.getByRole('form', { name: 'Assign this filing' });
  await assign.getByLabel('Preparer').selectOption({ label: 'Senior Y' });
  await assign.getByLabel('Reviewer').selectOption({ label: 'Manager X' });
  await assign.getByRole('button', { name: 'Assign' }).click();
  await expect(m.getByText(/^Task: GSTR-1 · 2026-09/)).toBeVisible();

  // The senior starts work (the clock runs), uploads, ticks, sends for review.
  let s = await outward(senior, engagementId);
  await s.getByRole('button', { name: 'Start work' }).click();
  await expect(s.getByText('In preparation')).toBeVisible();
  await s.getByLabel(/^Upload Sales register/).setInputFiles(file('sales-register-sep.pdf'));
  await expect(s.getByText('sales-register-sep.pdf')).toBeVisible();
  await s
    .getByLabel(/^Upload Reconcile sales register/)
    .setInputFiles(file('outward-recon-sep.pdf'));
  await expect(s.getByText('outward-recon-sep.pdf')).toBeVisible();
  // The tick is saved first, then shown: click and wait for it.
  const hsn = s.getByRole('checkbox', { name: /^HSN summary/ });
  await hsn.click();
  await expect(hsn).toBeChecked();
  await expect(s.getByText(/Checklist · 3 of 5 required done/i)).toBeVisible();
  await s.getByRole('button', { name: 'Send for review' }).click();
  await expect(s.getByText('In review', { exact: true })).toBeVisible();

  // The manager reviews and approves: Ready to file.
  m = await outward(manager, engagementId);
  await m.getByRole('button', { name: 'Start review' }).click();
  await expect(m.getByRole('button', { name: 'Start review' })).toBeHidden();
  await m.getByRole('button', { name: 'Approve' }).click();
  await expect(m.getByText('Ready to file', { exact: true })).toBeVisible();

  // The senior lodges with the ARN and the acknowledgement.
  s = await outward(senior, engagementId);
  await s.getByRole('button', { name: 'Lodge filing' }).click();
  const lodge = s.getByRole('form', { name: 'Lodge filing' });
  await lodge.getByLabel('Reference no.').fill(arn);
  await lodge.getByLabel('Upload acknowledgement').setInputFiles(file('gstr1-ack-sep.pdf'));
  await expect(senior.getByText('Acknowledgement uploaded.')).toBeVisible();
  await lodge.getByRole('button', { name: 'Lodge', exact: true }).click();
  const filed = s.getByRole('region', { name: 'Filed' });
  await expect(filed).toContainText(arn);
  await expect(filed).toContainText('By Senior Y');
  await expect(s.getByText('Checklist · 5 of 5 required done', { exact: false })).toBeVisible();

  // Activity: the filing on the timeline, and the senior's time on the task.
  await manager.goto(`/engagements/${engagementId}?tab=activity`);
  await expect(manager.getByText(arn).first()).toBeVisible();
  await manager
    .getByRole('tablist', { name: 'Activity view' })
    .getByRole('tab', { name: 'Time', exact: true })
    .click();
  await expect(manager.getByText('Recorded time', { exact: true })).toBeVisible();
  await expect(manager.getByRole('row', { name: /^Senior Y\b/ })).toBeVisible();
});

test('Inward reconciliation is marked Reconciled, with an internal reference', async ({
  browser,
}) => {
  const { engagementId } = await arrange();
  const manager = await signIn(browser, 'Manager X');
  const inward = await section(manager, engagementId, 'Inward', 'Inward reconciliation');
  await inward
    .getByLabel(/^Upload ITC reconciliation/)
    .setInputFiles(file('itc-recon-sep.xlsx.pdf'));
  await expect(inward.getByText('itc-recon-sep.xlsx.pdf')).toBeVisible();

  await inward.getByRole('button', { name: 'Mark reconciled' }).click();
  const form = inward.getByRole('form', { name: 'Lodge filing' });
  await expect(form.getByLabel('Reference type')).toHaveValue('internal');
  await form.getByLabel('Reference no.').fill('REC-2026-09');
  await form.getByRole('button', { name: 'Lodge', exact: true }).click();
  const done = inward.getByRole('region', { name: 'Filed' });
  await expect(done).toContainText('Reconciled');
  await expect(done).toContainText('REC-2026-09');
  await expect(inward.getByText('Reconciled', { exact: true }).first()).toBeVisible();
});
