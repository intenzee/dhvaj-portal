import type { PoolClient } from 'pg';
import {
  BULK_ASSIGN_SCOPE,
  DEFAULT_REVIEWER,
  REMINDER_CHANNEL_SETTING,
  ARTICLE_CLIENT_SCOPE,
  type ArticleClientScope,
  type BulkAssignScope,
  type DefaultReviewer,
  type ReminderChannelSetting,
} from '@hsdg/contracts';

/** The partners' workflow answers, as the services that act on them need them. */
export interface WorkflowPolicy {
  defaultReviewer: DefaultReviewer;
  articleClientScope: ArticleClientScope;
  clientReminderChannel: ReminderChannelSetting;
  bulkAssignScope: BulkAssignScope;
}

/** Today's behaviour, used when the firm row is missing. */
export const DEFAULT_WORKFLOW_POLICY: WorkflowPolicy = {
  defaultReviewer: DEFAULT_REVIEWER.engagementManager,
  articleClientScope: ARTICLE_CLIENT_SCOPE.office,
  clientReminderChannel: REMINDER_CHANNEL_SETTING.email,
  bulkAssignScope: BULK_ASSIGN_SCOPE.managersAndLeads,
};

/** Read inside the caller's transaction (any signed-in role may read firm_settings). */
export async function workflowPolicy(client: PoolClient): Promise<WorkflowPolicy> {
  const { rows } = await client.query<{
    default_reviewer: DefaultReviewer;
    article_client_scope: ArticleClientScope;
    client_reminder_channel: ReminderChannelSetting;
    bulk_assign_scope: BulkAssignScope;
  }>(
    `SELECT default_reviewer, article_client_scope, client_reminder_channel, bulk_assign_scope
       FROM hsdg.firm_settings LIMIT 1`,
  );
  const r = rows[0];
  return r
    ? {
        defaultReviewer: r.default_reviewer,
        articleClientScope: r.article_client_scope,
        clientReminderChannel: r.client_reminder_channel,
        bulkAssignScope: r.bulk_assign_scope,
      }
    : DEFAULT_WORKFLOW_POLICY;
}
