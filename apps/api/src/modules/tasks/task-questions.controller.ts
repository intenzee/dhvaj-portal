import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { NOTIFICATION_TYPE, PERMISSION } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { notLinkedToEmployee } from '../../common/errors/staff-link.messages';

export class AskAboutTaskDto {
  @ApiProperty({ description: 'The question for the person who gave the task.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question!: string;
}

/**
 * C-5 — "Ask <giver>" on My Work: whoever can see a task asks the person who
 * gave it (tasks.assigned_by_employee_id). The question reaches them as a
 * task_question notification that opens the task, and is audited.
 */
@ApiTags('engagement-tasks')
@Controller('engagements')
export class TaskQuestionsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  @Post(':id/tasks/:taskId/ask')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Ask the person who gave a task a question (notifies them)' })
  ask(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) engagementId: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() dto: AskAboutTaskDto,
  ): Promise<{ askedId: string; askedName: string | null }> {
    const ctx = rlsContextFromPrincipal(principal);
    const me = ctx.employeeId;
    if (!me) throw new BadRequestException(notLinkedToEmployee('ask about a task'));
    const question = dto.question.trim();
    if (!question) throw new BadRequestException('Write the question first.');
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        title: string;
        giver: string | null;
        giver_name: string | null;
        asker_name: string | null;
      }>(
        `SELECT t.title, t.assigned_by_employee_id AS giver, g.full_name AS giver_name,
                (SELECT full_name FROM hsdg.employees WHERE id = $3) AS asker_name
           FROM hsdg.tasks t
           LEFT JOIN hsdg.employees g ON g.id = t.assigned_by_employee_id
          WHERE t.id = $1 AND t.engagement_id = $2`,
        [taskId, engagementId, me],
      );
      const task = rows[0];
      if (!task) throw new NotFoundException('Task not found.');
      if (!task.giver) {
        throw new BadRequestException(
          'Nobody gave this task to you — ask the engagement’s Manager or Partner instead.',
        );
      }
      if (task.giver === me) throw new BadRequestException('You gave this task yourself.');
      await this.notifications.emitWith(client, ctx, {
        type: NOTIFICATION_TYPE.taskQuestion,
        recipientEmployeeIds: [task.giver],
        title: `${task.asker_name ?? 'Someone'} asks about: ${task.title}`,
        body: question,
        engagementId,
        objectType: 'task',
        objectId: taskId,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'task.asked',
        objectType: 'task',
        objectId: taskId,
        after: { to: task.giver, question },
      });
      return { askedId: task.giver, askedName: task.giver_name };
    });
  }
}
