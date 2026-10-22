/**
 * What to tell a signed-in user who can't act because the portal can't place
 * them as staff. Engagement work (time, filings, tasks) runs through the
 * employee record, not the login — so each message names the fix, not just the
 * failure. The link is read on every request, so a reload picks it up.
 */

/** The login has no employee record (`employees.user_id`) linked to it. */
export const notLinkedToEmployee = (action: string): string =>
  `Your login isn't linked to an employee record, so you can't ${action}. ` +
  'Ask an administrator to link it: Administration → People → edit your record → ' +
  'Portal login. Then reload this page.';

/** The login is linked, but the employee isn't on this engagement's team. */
export const notOnEngagementTeam = (action: string): string =>
  `You're not on this engagement's team, so you can't ${action}. ` +
  'Ask the engagement partner or manager to add you to the team.';

/** Pick the right one of the two for a non-member. */
export const notOnTeamReason = (employeeId: string | null | undefined, action: string): string =>
  employeeId ? notOnEngagementTeam(action) : notLinkedToEmployee(action);
