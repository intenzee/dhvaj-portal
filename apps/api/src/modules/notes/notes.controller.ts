import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type EngagementNote } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { NotesService } from './notes.service';
import { CreateNoteDto, NoteListQueryDto, UpdateNoteDto } from './dto/notes.dto';

/**
 * Engagement Notes (spec §26), routed under the engagement. Any member may read
 * and add (`engagement.read`); a note is editable/removable only by its author
 * or an engagement lead (enforced by RLS).
 */
@ApiTags('notes')
@Controller('engagements')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get(':id/notes')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'List engagement notes (filter ?engagementServiceId=&engagementComponentId=).',
  })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: NoteListQueryDto,
  ): Promise<EngagementNote[]> {
    const filter: { engagementServiceId?: string; engagementComponentId?: string } = {};
    if (query.engagementServiceId) filter.engagementServiceId = query.engagementServiceId;
    if (query.engagementComponentId) filter.engagementComponentId = query.engagementComponentId;
    return this.notes.list(rlsContextFromPrincipal(principal), id, filter);
  }

  @Post(':id/notes')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Add a note (any engagement member; audited).' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateNoteDto,
  ): Promise<EngagementNote> {
    return this.notes.create(rlsContextFromPrincipal(principal), id, dto);
  }

  @Patch(':id/notes/:noteId')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Edit or pin a note (author or lead; audited).' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('noteId', new ParseUUIDPipe()) noteId: string,
    @Body() dto: UpdateNoteDto,
  ): Promise<EngagementNote> {
    return this.notes.update(rlsContextFromPrincipal(principal), id, noteId, dto);
  }

  @Delete(':id/notes/:noteId')
  @HttpCode(204)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Remove a note (author or lead; audited).' })
  remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('noteId', new ParseUUIDPipe()) noteId: string,
  ): Promise<void> {
    return this.notes.remove(rlsContextFromPrincipal(principal), id, noteId);
  }
}
