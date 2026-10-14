import { expect, request, test } from '@playwright/test';

/**
 * Section-wise views: on Clients, picking GST shows only the client with a
 * live GST engagement — the Statutory Audit client drops out — and the choice
 * is kept in the URL (?section=gst), so it survives a reload. "All" brings
 * both back.
 */
const API = process.env.PW_API_URL ?? 'http://localhost:3001/api/v1';

async function arrange(stamp: string): Promise<void> {
  const api = await request.newContext();
  const res = await api.post(`${API}/auth/dev-token`, { data: { email: 'partner.a@dhvaj.in' } });
  expect(res.ok(), 'dev sign-in for partner.a').toBeTruthy();
  const { accessToken } = (await res.json()) as { accessToken: string };
  const post = async (path: string, data: object) => {
    const r = await api.post(`${API}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data,
    });
    expect(r.ok(), `POST ${path}: ${r.status()} ${await r.text()}`).toBeTruthy();
    return (await r.json()) as { id: string };
  };
  const client = (name: string) =>
    post('/entities', { legalName: `${stamp} ${name}`, typeSlug: 'private_limited', officeCode: 'NORTH' });

  const gst = await client('GST Traders');
  await post('/engagements', {
    kind: 'compliance',
    entityId: gst.id,
    status: 'accepted',
    financialYear: '2026-27',
    streams: ['gst'],
  });
  const audited = await client('Audited Co');
  await post('/engagements', {
    kind: 'statutory_audit',
    entityId: audited.id,
    status: 'accepted',
    financialYear: '2026-27',
  });
  await api.dispose();
}

test('Clients: GST only shows the GST client, kept in the URL', async ({ page }) => {
  const stamp = `PWSEC${String(Date.now()).slice(-6)}`;
  await arrange(stamp);

  await page.goto('/login');
  await page.getByRole('button', { name: /^Partner A/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));

  await page.goto('/entities');
  await page.getByPlaceholder('Search by name or PAN…').fill(stamp);
  const gstRow = page.getByRole('row', { name: new RegExp(`${stamp} GST Traders`) });
  const auditRow = page.getByRole('row', { name: new RegExp(`${stamp} Audited Co`) });
  await expect(gstRow).toBeVisible();
  await expect(auditRow).toBeVisible();

  const sections = page.getByRole('group', { name: 'Section' });
  await sections.getByRole('button', { name: 'GST', exact: true }).click();
  await expect(page).toHaveURL(/[?&]section=gst(&|$)/);
  await expect(gstRow).toBeVisible();
  await expect(auditRow).toHaveCount(0);
  await expect(sections.getByRole('button', { name: 'GST', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // The section survives a reload (the search box does not).
  await page.reload();
  await page.getByPlaceholder('Search by name or PAN…').fill(stamp);
  await expect(gstRow).toBeVisible();
  await expect(auditRow).toHaveCount(0);

  await sections.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page).not.toHaveURL(/section=/);
  await expect(auditRow).toBeVisible();
});
