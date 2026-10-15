import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Staff Workflow · Questions for the partners and Rollout, on Administration.
 * A partner (no user.manage) reaches Administration for the Workflow tab alone
 * and changes the default reviewer; the managing partner pilots a phase office
 * by office and hands it back to the deploy. Both are put back as they were.
 */
async function signInAs(browser: Browser, who: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(`^${who}`) }).click();
  // Past the login and the landing redirect that follows it.
  await page.waitForURL(
    (url) => !url.pathname.startsWith('/login') && !url.search.includes('landing'),
  );
  return page;
}

test('a partner answers the workflow questions on Administration → Workflow', async ({
  browser,
}) => {
  const partner = await signInAs(browser, 'Partner A');
  await partner.getByRole('link', { name: 'Administration' }).click();
  await expect(partner).toHaveURL(/\/admin$/);
  // Only the Workflow tab: a partner does not administer users or offices.
  await expect(partner.getByRole('button', { name: 'Users & Roles' })).toHaveCount(0);
  await expect(partner.getByRole('button', { name: 'Rollout' })).toHaveCount(0);

  const form = partner.getByRole('form', { name: 'Workflow policy' });
  const reviewer = form.getByLabel(/^Default reviewer/);
  const before = await reviewer.inputValue();
  const next = before === 'engagement_partner' ? 'stream_lead' : 'engagement_partner';
  await reviewer.selectOption(next);
  await form.getByRole('button', { name: 'Save policy' }).click();
  await expect(partner.getByText('Workflow policy saved.')).toBeVisible();
  await partner.reload();
  await expect(
    partner.getByRole('form', { name: 'Workflow policy' }).getByLabel(/^Default reviewer/),
  ).toHaveValue(next);

  // The per-form internal due dates are listed with the plan's suggestions.
  const forms = partner.getByRole('region', { name: 'Internal due date per form' });
  await expect(
    forms
      .getByRole('row')
      .filter({ hasText: /^GSTR-1/ })
      .first(),
  ).toBeVisible();

  // Put it back.
  const again = partner.getByRole('form', { name: 'Workflow policy' });
  await again.getByLabel(/^Default reviewer/).selectOption(before);
  await again.getByRole('button', { name: 'Save policy' }).click();
  await expect(partner.getByText('Workflow policy saved.').first()).toBeVisible();
});

test('the managing partner pilots a phase office by office on Administration → Rollout', async ({
  browser,
}) => {
  const mp = await signInAs(browser, 'Managing Partner');
  await mp.goto('/admin');
  await mp.getByRole('button', { name: 'Rollout', exact: true }).click();
  const today = mp.getByRole('listitem', { name: /Today and the filing drawer/ });
  await today.getByRole('button', { name: 'Change' }).click();
  const form = today.getByRole('form', { name: /Rollout of/ });
  await form.getByLabel('Where it is on').selectOption('offices');
  // Every office as pilots: nobody's screens change while other specs run.
  for (const box of await form.getByRole('checkbox').all()) await box.check();
  await form.getByLabel('Note').fill('Playwright pilot');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(today.getByText(/NORTH, SOUTH/).first()).toBeVisible();
  await expect(today).toContainText('Playwright pilot');

  await today.getByRole('button', { name: 'Change' }).click();
  await today.getByRole('button', { name: 'Follow the deploy' }).click();
  await expect(today).toContainText('follows the deploy');
  await expect(today.getByText('Every office')).toBeVisible();
});
