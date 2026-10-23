import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { FIRM_CHECK, type FirmChecks } from '@hsdg/contracts';
import { isStrict } from '../workflow-settings/firm-checks';

/**
 * The person a task goes to (assignee or reviewer) must be able to open the
 * engagement. With task_assign_team_only on, that means already on it (EP,
 * manager or team). With it off, anyone active in the engagement's office
 * will do (anyone at all for the managing partner); they join the team as a
 * member so the engagement shows on their list.
 */
export async function ensureOnEngagement(
  client: PoolClient,
  engagementId: string,
  employeeId: string,
  checks: FirmChecks,
  notOnTeam: string,
): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM hsdg.engagements e
      WHERE e.id = $1 AND (e.engagement_partner_id = $2 OR e.engagement_manager_id = $2)
     UNION
     SELECT 1 FROM hsdg.engagement_team t WHERE t.engagement_id = $1 AND t.employee_id = $2`,
    [engagementId, employeeId],
  );
  if (rows[0]) return;
  if (isStrict(checks, FIRM_CHECK.taskAssignTeamOnly)) throw new BadRequestException(notOnTeam);

  const { rows: ok } = await client.query(
    `SELECT 1
       FROM hsdg.employees p
       JOIN hsdg.engagements g ON g.id = $1
      WHERE p.id = $2 AND p.employment_status = 'active'
        AND (p.primary_office_id = g.office_id OR hsdg.ctx_is_business_firmwide())`,
    [engagementId, employeeId],
  );
  if (!ok[0]) {
    throw new BadRequestException(
      'Pick someone active in this engagement’s office — they join the team when the task goes to them.',
    );
  }
  await client.query(
    `INSERT INTO hsdg.engagement_team (engagement_id, employee_id, role_on_engagement)
     VALUES ($1, $2, 'member')
     ON CONFLICT (engagement_id, employee_id) DO NOTHING`,
    [engagementId, employeeId],
  );
}
