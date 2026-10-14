import { expect, request, test, type Browser, type Page } from '@playwright/test';

/**
 * Section-wise home: "GST only", "ROC only", in the browser. A company with a
 * GSTIN and a CIN gets a Compliance engagement running GST and ROC, both led
 * by Manager X, plus one task in each stream. On the home Compliance Calendar
 * the manager narrows to GST, opens a day inline and sees that day's GST
 * filings only; switches to ROC and sees AOC-4 instead; the choice survives a
 * reload and "View calendar" opens the firm calendar on the same section and
 * month. The My Tasks panel and the Tasks page filter the same way.
 */
const API = process.env.PW_API_URL ?? 'http://localhost:3001/api/v1';

interface Arranged {
  client: string;
  gstTask: string;
  rocTask: string;
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
  const managerX = employees.items.find((e) => e.employeeCode === 'EMP005')!.id;

  const n = String(Date.now()).slice(-4);
  const pan = `AAACS${n}K`;
  const client = `Playwright Sections ${n} Pvt Ltd`;
  const entity = (await call(pa, 'POST', '/entities', {
    legalName: client,
    typeSlug: 'private_limited',
    officeCode: 'NORTH',
    pan,
    registrations: [
      { registrationType: 'gstin', registrationNumber: `19${pan}1Z5`, stateCode: '19' },
      { registrationType: 'cin', registrationNumber: `U74999MH2019PTC${n}99` },
    ],
  })) as { id: string };
  const engagement = (await call(pa, 'POST', '/engagements', {
    kind: 'compliance',
    entityId: entity.id,
    status: 'accepted',
    financialYear: '2026-27',
    years: [{ financialYear: '2025-26' }, { financialYear: '2026-27' }],
    streams: ['gst', 'roc'],
    streamLeads: { gst: managerX, roc: managerX },
  })) as { id: string };
  await call(mp, 'PATCH', `/engagements/${engagement.id}`, {
    engagementManagerEmployeeId: managerX,
  });
  const detail = (await call(pa, 'GET', `/engagements/${engagement.id}`)) as {
    services: { id: string; stream: string | null }[];
  };
  const line = (stream: string) => detail.services.find((s) => s.stream === stream)!.id;
  const gstTask = `GSTR-3B reconciliation ${n}`;
  const rocTask = `AOC-4 board pack ${n}`;
  for (const [title, stream] of [
    [gstTask, 'gst'],
    [rocTask, 'roc'],
  ] as const) {
    await call(pa, 'POST', `/engagements/${engagement.id}/tasks`, {
      title,
      assignedToEmployeeId: managerX,
      dueDate: '2000-01-01',
      engagementServiceId: line(stream),
    });
  }
  await api.dispose();
  return { client, gstTask, rocTask };
}

async function signIn(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByRole('button', { name: /^Manager X/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  return page;
}

test('home calendar and tasks, section by section', async ({ browser }) => {
  const { client, gstTask, rocTask } = await arrange();
  const page = await signIn(browser);
  await page.goto('/');

  // The calendar opens on this month (October 2026: GSTR-3B for September is
  // due on the 20th, the provisional AOC-4 on the 30th).
  const calendar = page.getByRole('region', { name: 'Compliance Calendar' });
  await expect(calendar.getByText('October 2026')).toBeVisible();
  const section = calendar.getByLabel('Section');

  // GST only — the 20th lists this client's GSTR-3B.
  await section.selectOption('gst');
  await calendar.getByRole('button', { name: '20 October' }).click();
  const day20 = calendar.getByRole('region', { name: 'Filings due 20 Oct' });
  await expect(day20.getByText(client).first()).toBeVisible();
  await expect(day20.getByText(/GSTR-3B/).first()).toBeVisible();

  // ROC only — the 20th has nothing of this client; the 30th has its AOC-4.
  await section.selectOption('roc');
  await expect(day20).toHaveCount(0); // a section change closes the open day
  await calendar.getByRole('button', { name: '20 October' }).click();
  await expect(day20).toBeVisible();
  await expect(day20.getByText(client)).toHaveCount(0);
  await calendar.getByRole('button', { name: '30 October' }).click();
  const day30 = calendar.getByRole('region', { name: 'Filings due 30 Oct' });
  await expect(day30.getByText(client).first()).toBeVisible();
  await expect(day30.getByText(/AOC-4/).first()).toBeVisible();
  await expect(day30.getByText(/GSTR/)).toHaveCount(0);

  // The choice is remembered, and "View calendar" carries it.
  await page.reload();
  await expect(calendar.getByLabel('Section')).toHaveValue('roc');
  const link = calendar.getByRole('link', { name: /View calendar/ });
  await expect(link).toHaveAttribute('href', '/compliance?stream=roc&month=2026-10');
  await link.click();
  await page.waitForURL(/\/compliance\?stream=roc&month=2026-10/);
  await expect(page.getByRole('button', { name: 'ROC / MCA', pressed: true })).toBeVisible();
  await expect(page.getByText('October 2026')).toBeVisible(); // the month grid, on that month

  // My Tasks on the home page: ROC only.
  await page.goto('/');
  const tasks = page.getByRole('region', { name: 'My Tasks' });
  await tasks.getByLabel('Section').selectOption('roc');
  await expect(tasks.getByText(rocTask)).toBeVisible();
  await expect(tasks.getByText(gstTask)).toHaveCount(0);
  // ff_work_links: "View all" opens My Work's tasks, still on ROC.
  const viewAll = tasks.getByRole('link', { name: /View all/ });
  await expect(viewAll).toHaveAttribute('href', '/my-work?tab=tasks&section=roc');
  await viewAll.click();
  await page.waitForURL(/\/my-work\?tab=tasks&section=roc/);
  await expect(page.getByRole('button', { name: 'ROC / MCA', pressed: true })).toBeVisible();
  await expect(page.getByText(rocTask)).toBeVisible();
  await expect(page.getByText(gstTask)).toHaveCount(0);

  // The Tasks page keeps its sections in the URL; chips add sections.
  await page.goto('/tasks?section=gst');
  await expect(page.getByRole('button', { name: 'GST', exact: true, pressed: true })).toBeVisible();
  await expect(page.getByText(gstTask)).toBeVisible();
  await expect(page.getByText(rocTask)).toHaveCount(0);
  await page.getByRole('button', { name: 'ROC / MCA' }).click();
  await page.waitForURL(/section=gst%2Croc|section=gst,roc/);
  await expect(page.getByText(rocTask)).toBeVisible();
  await expect(page.getByText(gstTask)).toBeVisible();
});
