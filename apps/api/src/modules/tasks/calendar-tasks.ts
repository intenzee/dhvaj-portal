/**
 * The calendar's own task on a filing (Phase 2, C-1): one per filing, made
 * when the calendar builds it (hsdg.make_filing_tasks). While nobody has
 * touched it (to do, never handed on), creating a task for that filing takes
 * it over instead of adding a second one (tasks_one_per_source_instance), and
 * from then on it is an ordinary task.
 *
 * Same parameters as createTask's INSERT: $1 engagement, $2 title,
 * $3 description, $4 assignee, $5 creator, $6 priority, $7 due date,
 * $8 out of scope, $9 billable, $10 stream line, $11 reviewer, $12 work type,
 * $13 filing, $14 audit area.
 */
export const TAKE_OVER_CALENDAR_TASK_SQL = `
  UPDATE hsdg.tasks
     SET title = $2, description = $3, assigned_to_employee_id = $4,
         created_by_employee_id = $5, assigned_by_employee_id = $5,
         priority = COALESCE($6, 'normal'), due_date = COALESCE($7, due_date),
         is_out_of_scope = COALESCE($8, false), is_billable = COALESCE($9, false),
         engagement_service_id = COALESCE($10, engagement_service_id),
         reviewer_employee_id = $11, work_type = $12, audit_work_area_id = $14,
         auto_created = false, version = version + 1
   WHERE engagement_id = $1 AND source_compliance_instance_id = $13
     AND auto_created AND status = 'todo' AND assigned_by_employee_id IS NULL
  RETURNING id`;
