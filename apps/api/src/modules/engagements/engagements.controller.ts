import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { EngagementsService } from './engagements.service';
import type { EngagementDetail, EngagementFilter, EngagementSummary } from './engagements.types';
import { CreateEngagementDto } from './dto/create-engagement.dto';
import { UpdateEngagementDto } from './dto/update-engagement.dto';
import { EngagementListQueryDto } from './dto/engagement-list-query.dto';
import { AssignTeamMemberDto, ReassignPartnerDto } from './dto/engagement-commands.dto';

@ApiTags('engagements')
@Controller('engagements')
export class EngagementsController {
  constructor(private readonly engagements: EngagementsService) {}

  @Get()
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'List engagements the caller can access (paginated)',
    description:
      'RLS-scoped to assignment (EP / manager / team), independent of office. Firm-wide roles see all. Filter by status/entity/service/office or ?mine=true.',
  })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: EngagementListQueryDto,
  ): Promise<Paginated<EngagementSummary>> {
    const filter: EngagementFilter = {};
    if (query.status) filter.status = query.status;
    if (query.entityId) filter.entityId = query.entityId;
    if (query.serviceCode) filter.serviceCode = query.serviceCode;
    if (query.officeCode) filter.officeCode = query.officeCode;
    if (query.mine !== undefined) filter.mine = query.mine;
    const result = await this.engagements.listEngagements(
      rlsContextFromPrincipal(principal),
      filter,
      query,
    );
    return paginate(result, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Get an engagement with its team',
    description: '404 unless the caller is assigned (or firm-wide) — scope is not leaked.',
  })
  async getById(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<EngagementDetail> {
    const engagement = await this.engagements.getEngagementById(
      rlsContextFromPrincipal(principal),
      id,
    );
    if (!engagement) throw new NotFoundException('Engagement not found.');
    return engagement;
  }

  @Post()
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Create an engagement (audited)' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateEngagementDto,
  ): Promise<EngagementDetail> {
    return this.engagements.createEngagement(rlsContextFromPrincipal(principal), dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update an engagement (audited; optimistic concurrency)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateEngagementDto,
  ): Promise<EngagementDetail> {
    return this.engagements.updateEngagement(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post(':id/reassign-partner')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Change the accountable Engagement Partner (audited)',
    description: 'Changing accountability requires firm-wide authority.',
  })
  reassignPartner(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReassignPartnerDto,
  ): Promise<EngagementDetail> {
    return this.engagements.reassignPartner(
      rlsContextFromPrincipal(principal),
      id,
      dto.engagementPartnerEmployeeId,
      dto.reason,
    );
  }

  @Post(':id/team')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Assign a team member (audited)' })
  assignTeam(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignTeamMemberDto,
  ): Promise<EngagementDetail> {
    return this.engagements.assignTeamMember(rlsContextFromPrincipal(principal), id, dto);
  }

  @Delete(':id/team/:employeeId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Remove a team member (audited)' })
  removeTeam(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
  ): Promise<EngagementDetail> {
    return this.engagements.removeTeamMember(rlsContextFromPrincipal(principal), id, employeeId);
  }
}
