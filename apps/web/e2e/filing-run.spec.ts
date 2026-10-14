import { expect, test, type Locator, type Page } from '@playwright/test';
import { arrangeGstEngagement, pdf, signIn, type Arranged } from './support/gst-engagement';

/**
 * Staff Workflow Phase 3 acceptance (WF-301): a filing run. The manager opens
 * September's GSTR-1 across clients and assigns three in one action; the senior
 * works one down the list in the drawer, the manager reviews it there, and the
 * senior lodges it — the grid shows it filed, and the run's progress moves,
 * without a reload.
 */

const RUN = `/compliance/runs?run=${encodeURIComponent('GST_GSTR1_M|2026-09')}`;

const rowOf = (page: Page, entityName: string): Locator =>
  page.getByRole('row').filter({ hasText: entityName });

/** The run's progress, "18 of 42 filed", as numbers. */
async function progress(page: Page): Promise<{ filed: number; total: number }> {
  const label = await page.getByRole('progressbar').getAttribute('aria-label');
  const m = /^(\d+) of (\d+) filed$/.exec(label ?? '');
  expect(m, `progress label "${label}"`).toBeTruthy();
  return { filed: Number(m![1]), total: Number(m![2]) };
}

/** Pick the option whose text starts with the person's name ("Senior Y · Senior"). */
async function choose(select: Locator, name: string): Promise<void> {
  const value = await select
    .locator('option', { hasText: new RegExp(`^${name}`) })
    .getAttribute('value');
  await select.selectOption(value!);
}

/** Open a client's filing in the drawer from the grid. */
async function openInDrawer(page: Page, entityName: string): Promise<Locator> {
  await rowOf(page, entityName).getByRole('link', { name: entityName }).click();
  await page.waitForURL((u) => u.searchParams.has('open'));
  const drawer = page.getByRole('dialog', { name: new RegExp(entityName) });
  await expect(drawer).toBeVisible();
  return drawer;
}

test('a filing run: bulk assign, work one in the drawer, lodge — the grid updates', async ({
  browser,
}) => {
  const clients: Arranged[] = [];
  for (let i = 0; i < 3; i++) clients.push(await arrangeGstEngagement());
  const [first] = clients as [Arranged, ...Arranged[]];
  const manager = await signIn(browser, 'Manager X');
  const senior = await signIn(browser, 'Senior Y');

  // The manager assigns all three in one action: Senior Y prepares, Manager X reviews.
  await manager.goto(RUN);
  for (const c of clients) {
    await expect(rowOf(manager, c.entityName)).toBeVisible();
    await manager.getByRole('checkbox', { name: `Select ${c.entityName}` }).check();
  }
  await manager.getByRole('button', { name: 'Assign (3)' }).click();
  const modal = manager.getByRole('dialog', { name: 'Assign 3 filings' });
  await choose(modal.getByLabel('Preparer'), 'Senior Y');
  await choose(modal.getByLabel('Reviewer'), 'Manager X');
  await modal.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(modal).toBeHidden();
  for (const c of clients) {
    await expect(rowOf(manager, c.entityName)).toContainText('Senior Y');
    await expect(rowOf(manager, c.entityName)).toContainText('Manager X');
  }

  // The senior works the first one in the drawer, from the run.
  await senior.goto(RUN);
  let d = await openInDrawer(senior, first.entityName);
  await d.getByRole('button', { name: 'Start work' }).click();
  await expect(d.getByText('In preparation')).toBeVisible();
  await d.getByLabel(/^Upload Sales register/).setInputFiles(pdf('sales-register-sep.pdf'));
  await expect(d.getByText('sales-register-sep.pdf')).toBeVisible();
  await d
    .getByLabel(/^Upload Reconcile sales register/)
    .setInputFiles(pdf('outward-recon-sep.pdf'));
  await expect(d.getByText('outward-recon-sep.pdf')).toBeVisible();
  const hsn = d.getByRole('checkbox', { name: /^HSN summary/ });
  await hsn.click();
  await expect(hsn).toBeChecked();
  await d.getByRole('button', { name: 'Send for review' }).click();
  await expect(d.getByText('In review', { exact: true }).first()).toBeVisible();

  // The manager reviews and approves it in the drawer.
  await manager.goto(RUN);
  d = await openInDrawer(manager, first.entityName);
  await d.getByRole('button', { name: 'Start review' }).click();
  await expect(d.getByRole('button', { name: 'Start review' })).toBeHidden();
  await d.getByRole('button', { name: 'Approve' }).click();
  await expect(d.getByText('Ready to file', { exact: true }).first()).toBeVisible();

  // The senior lodges it from the grid's Lodge button; the grid shows it filed.
  await senior.goto(RUN);
  const before = await progress(senior);
  await rowOf(senior, first.entityName).getByRole('button', { name: 'Lodge' }).click();
  d = senior.getByRole('dialog', { name: new RegExp(first.entityName) });
  await d.getByRole('button', { name: 'Lodge filing' }).click();
  const lodge = d.getByRole('form', { name: 'Lodge filing' });
  await lodge.getByLabel('Reference no.').fill(first.arn);
  await lodge.getByLabel('Upload acknowledgement').setInputFiles(pdf('gstr1-ack-sep.pdf'));
  await expect(senior.getByText('Acknowledgement uploaded.')).toBeVisible();
  await lodge.getByRole('button', { name: 'Lodge', exact: true }).click();
  await expect(d.getByRole('region', { name: 'Filed' })).toContainText(first.arn);

  const row = rowOf(senior, first.entityName);
  await expect(row.getByText('Filed', { exact: true })).toBeVisible();
  await expect(row).toContainText(first.arn);
  await expect
    .poll(() => progress(senior))
    .toEqual({ filed: before.filed + 1, total: before.total });
});
