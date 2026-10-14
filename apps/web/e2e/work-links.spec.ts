import { expect, test, type Page } from '@playwright/test';
import { arrangeGstEngagement, MONTH, outward, pdf, signIn } from './support/gst-engagement';

/**
 * Staff Workflow Phase 1 acceptance (WF-103/104/105): every list opens the work
 * itself. From My Work the senior lands on September's Outward section with
 * their task row flashed; the manager's "Waiting for my review" panel and the
 * Compliance calendar land on the same filing — one click each, no hunting.
 */

/** The page is on the engagement's GST tab, September, Outward — and shows it. */
async function expectOnSeptemberOutward(page: Page, engagementId: string): Promise<URL> {
  await page.waitForURL((u) => u.pathname === `/engagements/${engagementId}`);
  const url = new URL(page.url());
  expect(url.searchParams.get('tab')).toBe('gst');
  expect(url.searchParams.get('m')).toBe(MONTH);
  expect(url.searchParams.get('part')).toBe('outward');
  const region = page.getByRole('region', { name: 'Outward', exact: true });
  await expect(region.getByRole('heading', { name: 'GSTR-1' })).toBeInViewport();
  return url;
}

test('My Work, the review panel and the calendar each open the filing in one click', async ({
  browser,
}) => {
  const { engagementId, entityName } = await arrangeGstEngagement();
  const manager = await signIn(browser, 'Manager X');
  const senior = await signIn(browser, 'Senior Y');

  // The manager assigns September's GSTR-1: Senior Y prepares, Manager X reviews.
  const m = await outward(manager, engagementId);
  const assign = m.getByRole('form', { name: 'Assign this filing' });
  await assign.getByLabel('Preparer').selectOption({ label: 'Senior Y' });
  await assign.getByLabel('Reviewer').selectOption({ label: 'Manager X' });
  await assign.getByRole('button', { name: 'Assign' }).click();
  await expect(m.getByText(/^Task: GSTR-1 · 2026-09/)).toBeVisible();

  // WF-104: My Work's task title opens the month and part, and flashes the task.
  await senior.goto('/my-work');
  const row = senior.getByRole('row').filter({ hasText: entityName });
  await expect(row.getByText(/^GSTR-1 · Sep 2026/)).toBeVisible(); // the filing context
  await row.getByRole('link', { name: /^GSTR-1/ }).click();
  const fromMyWork = await expectOnSeptemberOutward(senior, engagementId);
  const taskId = fromMyWork.searchParams.get('task');
  expect(taskId).toBeTruthy();
  await expect(senior.locator(`[data-task-id="${taskId}"]`).first()).toHaveAttribute(
    'data-work-highlight',
    '',
  );

  // The senior prepares it and sends it for review.
  const s = senior.getByRole('region', { name: 'Outward', exact: true });
  await s.getByRole('button', { name: 'Start work' }).click();
  await expect(s.getByText('In preparation')).toBeVisible();
  await s.getByLabel(/^Upload Sales register/).setInputFiles(pdf('sales-register-sep.pdf'));
  await expect(s.getByText('sales-register-sep.pdf')).toBeVisible();
  await s
    .getByLabel(/^Upload Reconcile sales register/)
    .setInputFiles(pdf('outward-recon-sep.pdf'));
  await expect(s.getByText('outward-recon-sep.pdf')).toBeVisible();
  const hsn = s.getByRole('checkbox', { name: /^HSN summary/ });
  await hsn.click();
  await expect(hsn).toBeChecked();
  await s.getByRole('button', { name: 'Send for review' }).click();
  await expect(s.getByText('In review', { exact: true })).toBeVisible();

  // WF-105: it is waiting for the manager's review on Home, and opens there.
  await manager.goto('/');
  const waiting = manager.getByRole('link').filter({ hasText: entityName });
  await expect(waiting.first()).toContainText(/waiting today/);
  await waiting.first().click();
  const fromQueue = await expectOnSeptemberOutward(manager, engagementId);
  expect(fromQueue.searchParams.get('task')).toBe(taskId);
  await expect(
    manager.getByRole('region', { name: 'Outward', exact: true }).getByRole('button', {
      name: 'Start review',
    }),
  ).toBeVisible();

  // WF-103: the Compliance calendar opens the same filing.
  await manager.goto('/compliance');
  const filing = manager
    .getByRole('row')
    .filter({ hasText: entityName })
    .filter({ hasText: 'GSTR-1' })
    .filter({ hasText: 'Sep 2026' });
  await filing.getByRole('link', { name: entityName }).click();
  await expectOnSeptemberOutward(manager, engagementId);
});

test('a link to a tab the engagement does not have says so on Overview', async ({ browser }) => {
  const { engagementId } = await arrangeGstEngagement();
  const manager = await signIn(browser, 'Manager X');
  await manager.goto(`/engagements/${engagementId}?tab=income_tax&fy=2026-27`);
  await expect(manager.getByRole('status')).toContainText(/has no .* tab/);
});
