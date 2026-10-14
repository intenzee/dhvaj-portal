import { expect, request, test, type Browser, type Page } from '@playwright/test';

/**
 * Spec acceptance (B7): the AGM moves the AGM-linked forms, in the browser. A
 * private company with a CIN gets a Compliance engagement for FY 2025-26 with
 * Manager X leading ROC. Before the AGM, AOC-4 sits on its provisional date
 * (30 Oct). The manager records the AGM held on 25 Sep from the ROC tab's
 * Events panel: the what-changed summary says AOC-4 moved and the annual pill
 * shows 25 Oct. Voiding the event (with a reason) puts AOC-4 back on 30 Oct.
 *
 * P1-9: AGM held → AOC-4 lodged with SRN. The form offers the AGM's FY (the
 * previous one) by default; once the AGM is recorded, AOC-4's "AGM held" line
 * has ticked itself, and the manager lodges AOC-4 with its SRN and the
 * acknowledgement, inline. Activity shows the lodge with the SRN.
 */
const API = process.env.PW_API_URL ?? 'http://localhost:3001/api/v1';
const FY = '2025-26';

async function arrange(): Promise<string> {
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
  const managerX = employees.items.find((e) => e.employeeCode === 'EMP005')!.id;

  const n = String(Date.now()).slice(-5);
  const entity = (await call(pa, 'POST', '/entities', {
    legalName: `Playwright Makers ${n} Pvt Ltd`,
    typeSlug: 'private_limited',
    officeCode: 'NORTH',
    pan: `AAACP${n.slice(-4)}M`,
    registrations: [{ registrationType: 'cin', registrationNumber: `U74999MH2019PTC${n}9` }],
  })) as { id: string };
  const engagement = (await call(pa, 'POST', '/engagements', {
    kind: 'compliance',
    entityId: entity.id,
    status: 'accepted',
    financialYear: '2026-27',
    years: [{ financialYear: FY }, { financialYear: '2026-27' }],
    streams: ['roc'],
    streamLeads: { roc: managerX },
  })) as { id: string };
  await call(mp, 'PATCH', `/engagements/${engagement.id}`, {
    engagementManagerEmployeeId: managerX,
  });
  await api.dispose();
  return engagement.id;
}

async function signIn(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByRole('button', { name: /^Manager X/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  return page;
}

/** The AOC-4 pill on the ROC tab's annual card, by its due date. */
const aoc4 = (page: Page, due: string) =>
  page.getByRole('button', { name: new RegExp(`AOC-4 · ${due}`) });

test('recording the AGM moves AOC-4; voiding it moves it back', async ({ browser }) => {
  const engagementId = await arrange();
  const page = await signIn(browser);
  await page.goto(`/engagements/${engagementId}?tab=roc&fy=${FY}`);

  // Nothing recorded: AOC-4 runs from the provisional AGM date (30 Sep → 30 Oct).
  await expect(aoc4(page, '30 Oct 2026')).toBeVisible();

  // Record the AGM held on 25 Sep, inline (no pop-up).
  await page.getByRole('button', { name: 'Record event' }).click();
  const form = page.getByRole('form', { name: 'Record event' });
  await form.getByLabel(/^Event/).selectOption({ label: 'AGM held' });
  await form.getByLabel(/^Date/).fill('2026-09-25');
  await form.getByRole('button', { name: 'Record', exact: true }).click();

  const changed = page.getByRole('status').filter({ hasText: 'what changed' });
  await expect(changed).toContainText(/AOC-4 moved/);
  await expect(aoc4(page, '25 Oct 2026')).toBeVisible();
  const events = page.getByRole('list', { name: 'Recorded events' });
  await expect(events).toContainText('AGM held');

  // Void it with a reason: AOC-4 goes back to the provisional date.
  await events.getByRole('button', { name: /AGM held/ }).click();
  await events.getByRole('button', { name: 'Void', exact: true }).click();
  const voidForm = page.getByRole('form', { name: 'Void event' });
  await voidForm.getByLabel(/^Why void it/).fill('Recorded against the wrong company');
  await voidForm.getByRole('button', { name: 'Void event' }).click();
  await expect(events).toContainText('Voided');
  await expect(aoc4(page, '30 Oct 2026')).toBeVisible();

  // Activity shows the event recorded and voided.
  await page.goto(`/engagements/${engagementId}?tab=activity`);
  await expect(page.getByText(/AGM held/).first()).toBeVisible();
});

test('AGM held → AOC-4 lodged with SRN', async ({ browser }) => {
  const engagementId = await arrange();
  const page = await signIn(browser);
  await page.goto(`/engagements/${engagementId}?tab=roc&fy=${FY}`);
  await expect(aoc4(page, '30 Oct 2026')).toBeVisible();

  // The AGM held on 25 Sep adopts FY 2025-26's accounts — the form's default FY.
  await page.getByRole('button', { name: 'Record event' }).click();
  const form = page.getByRole('form', { name: 'Record event' });
  await form.getByLabel(/^Event/).selectOption({ label: 'AGM held' });
  await form.getByLabel(/^Date/).fill('2026-09-25');
  await expect(form.getByLabel(/^FY/)).toHaveValue(FY);
  await form.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(aoc4(page, '25 Oct 2026')).toBeVisible();

  // Open AOC-4 in place: "AGM held" has ticked itself from the event.
  await aoc4(page, '25 Oct 2026').click();
  const checklist = page.getByRole('region', { name: 'Checklist' });
  await expect(checklist.getByRole('checkbox', { name: 'AGM held' })).toBeChecked();

  // Lodge with the SRN and the acknowledgement.
  await page.getByRole('button', { name: 'Lodge filing' }).click();
  const lodge = page.getByRole('form', { name: 'Lodge filing' });
  await expect(lodge.getByLabel(/^Reference type/)).toHaveValue('srn');
  await lodge.getByLabel(/^Reference no\./).fill('AB1234567');
  await lodge.getByLabel('Upload acknowledgement').setInputFiles({
    name: 'aoc4-challan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
  });
  await expect(lodge.getByLabel(/^Acknowledgement/)).not.toHaveValue('');
  await lodge.getByRole('button', { name: 'Lodge', exact: true }).click();

  const filed = page.getByRole('region', { name: 'Filed' });
  await expect(filed).toContainText('AB1234567');
  await expect(filed).toContainText(/^Filed/);

  // Activity shows the lodge with its SRN.
  await page.goto(`/engagements/${engagementId}?tab=activity`);
  await expect(page.getByText(/SRN AB1234567/).first()).toBeVisible();
});
