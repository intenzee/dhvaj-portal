import { expect, request, test } from '@playwright/test';
import { API, arrangeGstEngagement, signIn } from './support/gst-engagement';

/**
 * Staff Workflow WF-105/106 (ff_work_links): the old list routes redirect to
 * their My Work tab, "To Review" is the review queue — a filing sent to the
 * manager is reviewed from its row and leaves the queue — the sidebar's My Work
 * item carries the waiting count, and a lead can switch Tasks to the team.
 */

/** Senior Y's task on the engagement, sent for Manager X's review. */
async function taskSentForReview(engagementId: string, title: string): Promise<void> {
  const api = await request.newContext();
  const token = async (email: string) => {
    const res = await api.post(`${API}/auth/dev-token`, { data: { email } });
    expect(res.ok(), `dev sign-in for ${email}`).toBeTruthy();
    return ((await res.json()) as { accessToken: string }).accessToken;
  };
  const call = async (t: string, path: string, data: object = {}) => {
    const res = await api.post(`${API}${path}`, {
      headers: { Authorization: `Bearer ${t}` },
      data,
    });
    expect(res.ok(), `POST ${path}: ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  };
  const pa = await token('partner.a@dhvaj.in');
  const sy = await token('senior.y@dhvaj.in');
  const employees = (await (
    await api.get(`${API}/employees?limit=100`, { headers: { Authorization: `Bearer ${pa}` } })
  ).json()) as { items: { id: string; employeeCode: string }[] };
  const emp = (code: string) => employees.items.find((e) => e.employeeCode === code)!.id;
  const task = (await call(pa, `/engagements/${engagementId}/tasks`, {
    title,
    assignedToEmployeeId: emp('EMP006'),
    reviewerEmployeeId: emp('EMP005'),
  })) as { id: string };
  await call(sy, `/engagements/${engagementId}/tasks/${task.id}/start`);
  await call(sy, `/engagements/${engagementId}/tasks/${task.id}/send-for-review`);
  await api.dispose();
}

test('old list routes redirect to their My Work tab, keeping the link’s query', async ({
  browser,
}) => {
  const page = await signIn(browser, 'Manager X');

  await page.goto('/tasks');
  await page.waitForURL(/\/my-work\?tab=tasks$/);
  await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();

  await page.goto('/client-dependencies');
  await page.waitForURL(/\/my-work\?tab=client-dependencies$/);

  await page.goto('/reviews?filter=signoff');
  await page.waitForURL(/\/my-work\?filter=signoff&tab=to-review$/);
  await expect(page.getByRole('button', { name: /^Sign-offs/, pressed: true })).toBeVisible();
  // The document-upload notifications keep their own tab.
  await expect(page.getByRole('button', { name: 'New client uploads' })).toBeVisible();

  // Home's own links go straight to the tab, with no redirect hop on the way.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible();
  await expect(page.locator('main a[href^="/my-work"]').first()).toBeVisible();
  await expect(
    page.locator('a[href^="/tasks"], a[href^="/reviews"], a[href^="/client-dependencies"]'),
  ).toHaveCount(0);
});

test('a filing review is acted on from My Work and leaves the queue', async ({ browser }) => {
  const { engagementId, entityName } = await arrangeGstEngagement();
  const title = `Review me ${Date.now()}`;
  await taskSentForReview(engagementId, title);

  const page = await signIn(browser, 'Manager X');
  await page.goto('/my-work?tab=to-review');

  // The sidebar's My Work item counts what is waiting.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: /My Work/ }).getByLabel(/\d+ waiting/)).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row).toContainText(entityName);
  await expect(row.getByRole('link', { name: new RegExp(title) })).toHaveAttribute(
    'href',
    new RegExp(`/engagements/${engagementId}`),
  );

  await row.getByRole('button', { name: 'Start review' }).click();
  // The queue refetches with the task's new version before the next action.
  await expect(row.getByRole('button', { name: 'Start review' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(0);
});

test('a lead switches My Work tasks to the team', async ({ browser }) => {
  const { engagementId } = await arrangeGstEngagement();
  const title = `Team task ${Date.now()}`;
  await taskSentForReview(engagementId, title); // Senior Y's task, on Manager X's engagement

  const page = await signIn(browser, 'Manager X');
  await page.goto('/my-work?tab=tasks');
  await expect(page.getByText(title)).toHaveCount(0); // not assigned to the manager

  await page.getByRole('button', { name: 'Team', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Senior Y');
  await expect(page.getByRole('columnheader', { name: 'Assignee' })).toBeVisible();
});
