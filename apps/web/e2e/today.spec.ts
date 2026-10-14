import { expect, test, type Locator, type Page } from '@playwright/test';
import { arrangeGstEngagement, pdf, signIn } from './support/gst-engagement';

/**
 * Staff Workflow Phase 2 acceptance (WF-201/202): a filing's whole life worked
 * from Today and the filing drawer. Manager X assigns it in the drawer over the
 * Compliance calendar; Senior Y signs in, lands on Today with the late GSTR-1
 * among the work to prepare, opens it with the keyboard, prepares it and sends
 * it for review; Manager X reviews and approves it from their own Today; Senior
 * Y lodges it — and never opens the engagement page. Both people's time is
 * recorded on the way (WF-205).
 */

/** One Today group (To prepare, To review, Due this week …). */
const group = (page: Page, label: string): Locator =>
  page.getByRole('region', { name: new RegExp(`^${label}`) });

/** The client's GSTR-1 row in a Today group. */
const gstr1Row = (g: Locator, entityName: string): Locator =>
  g
    .getByRole('listitem')
    .filter({ hasText: entityName })
    .filter({ hasText: /^GSTR-1/ });

/** The filing drawer, open on September's GSTR-1. */
async function drawerOn(page: Page): Promise<Locator> {
  const drawer = page.getByRole('dialog', { name: /GSTR-1/ });
  await expect(drawer).toBeVisible();
  expect(new URL(page.url()).searchParams.get('open')).toBeTruthy();
  return drawer;
}

test('a filing is assigned, prepared, reviewed and lodged from Today, in the drawer', async ({
  browser,
}) => {
  const { engagementId, entityName, arn } = await arrangeGstEngagement();
  const manager = await signIn(browser, 'Manager X');

  // The GST lead assigns September's GSTR-1 in the drawer over the Compliance
  // calendar. (Their own Today lists every late filing they lead, most urgent
  // first: April's before September's.)
  await manager.goto('/compliance');
  await manager
    .getByRole('row')
    .filter({ hasText: entityName })
    .filter({ hasText: 'GSTR-1' })
    .filter({ hasText: 'Sep 2026' })
    .getByRole('link', { name: entityName })
    .click();
  let m = await drawerOn(manager);
  const assign = m.getByRole('form', { name: 'Assign this filing' });
  await assign.getByLabel('Preparer').selectOption({ label: 'Senior Y' });
  await assign.getByLabel('Reviewer').selectOption({ label: 'Manager X' });
  await assign.getByRole('button', { name: 'Assign' }).click();
  await expect(m.getByText(/^Task: GSTR-1 · 2026-09/)).toBeVisible();

  // Senior Y lands on Today; the late GSTR-1 is there to prepare, overdue first.
  const senior = await signIn(browser, 'Senior Y');
  const visited: string[] = [];
  senior.on('framenavigated', (f) => {
    if (f === senior.mainFrame()) visited.push(new URL(f.url()).pathname);
  });
  await senior.waitForURL((u) => u.pathname === '/today');
  const prepare = group(senior, 'To prepare');
  await expect(gstr1Row(prepare, entityName)).toBeVisible();
  await expect(prepare.getByRole('listitem').first()).toContainText(/days? overdue/i);

  // j moves down the list to it, Enter opens it in the drawer; the work happens there.
  const selected = senior.locator('li[aria-current="true"]');
  for (let i = 0; i < 50; i += 1) {
    await senior.keyboard.press('j');
    if ((await selected.textContent())?.includes(entityName)) break;
  }
  await expect(selected).toContainText(entityName);
  await senior.keyboard.press('Enter');
  let s = await drawerOn(senior);
  await expect(s).toContainText(entityName);
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
  // The list behind the drawer follows: nothing of this client's left to prepare.
  await expect(gstr1Row(prepare, entityName)).toHaveCount(0);

  // Manager X reviews and approves it from their Today.
  await manager.goto('/today');
  await gstr1Row(group(manager, 'To review'), entityName)
    .getByRole('link', { name: /^GSTR-1/ })
    .click();
  m = await drawerOn(manager);
  await m.getByRole('button', { name: 'Start review' }).click();
  await expect(m.getByRole('button', { name: 'Start review' })).toBeHidden();
  await m.getByRole('button', { name: 'Approve' }).click();
  await expect(m.getByText('Ready to file', { exact: true })).toBeVisible();

  // Senior Y lodges it with the ARN and the acknowledgement, still from Today.
  await senior.goto('/today');
  await gstr1Row(group(senior, 'Due this week'), entityName)
    .getByRole('link', { name: /^GSTR-1/ })
    .click();
  s = await drawerOn(senior);
  await s.getByRole('button', { name: 'Lodge filing' }).click();
  const lodge = s.getByRole('form', { name: 'Lodge filing' });
  await lodge.getByLabel('Reference no.').fill(arn);
  await lodge.getByLabel('Upload acknowledgement').setInputFiles(pdf('gstr1-ack-sep.pdf'));
  await expect(senior.getByText('Acknowledgement uploaded.')).toBeVisible();
  await lodge.getByRole('button', { name: 'Lodge', exact: true }).click();
  const filed = s.getByRole('region', { name: 'Filed' });
  await expect(filed).toContainText(arn);
  await expect(filed).toContainText('By Senior Y');

  // Filed work leaves the day.
  await s.getByRole('button', { name: 'Close' }).click();
  await expect(gstr1Row(group(senior, 'Due this week'), entityName)).toHaveCount(0);
  expect(visited.filter((p) => p.startsWith('/engagements'))).toEqual([]);

  // WF-205: the clock followed the work — both people's time is on the engagement,
  // and nobody entered any.
  await manager.goto(`/engagements/${engagementId}?tab=activity`);
  await manager
    .getByRole('tablist', { name: 'Activity view' })
    .getByRole('tab', { name: 'Time', exact: true })
    .click();
  await expect(manager.getByText('Recorded time', { exact: true })).toBeVisible();
  await expect(manager.getByRole('row', { name: /^Senior Y\b/ })).toBeVisible();
  await expect(manager.getByRole('row', { name: /^Manager X\b/ })).toBeVisible();
});
