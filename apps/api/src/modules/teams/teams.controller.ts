import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type AssignTeamClientsResult,
  type SetClientTeamResult,
  type TeamDetail,
  type TeamPerson,
  type TeamSummary,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import {
  AddTeamMembersDto,
  AssignTeamClientsDto,
  CreateTeamDto,
  SetClientTeamDto,
  UpdateTeamDto,
} from './dto/teams.dto';
import { TeamsService } from './teams.service';

/** CM-8 · People → Teams. Reads need team.read; every write team.manage (D9). */
@ApiTags('teams')
@Controller()
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get('teams/people')
  @RequirePermissions(PERMISSION.teamRead)
  @ApiOperation({ summary: 'Everyone a client team can hold, from every office' })
  people(@CurrentPrincipal() principal: Principal): Promise<TeamPerson[]> {
    return this.teams.people(rlsContextFromPrincipal(principal));
  }

  @Get('teams')
  @RequirePermissions(PERMISSION.teamRead)
  @ApiOperation({ summary: 'Client teams' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query('q') q?: string,
    @Query('officeId') officeId?: string,
    @Query('archived') archived?: string,
  ): Promise<TeamSummary[]> {
    return this.teams.list(rlsContextFromPrincipal(principal), {
      q,
      officeId: officeId && /^[0-9a-f-]{36}$/i.test(officeId) ? officeId : undefined,
      archived: archived === 'true',
    });
  }

  @Post('teams')
  @RequirePermissions(PERMISSION.teamManage)
  @ApiOperation({ summary: 'Create a client team' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateTeamDto,
  ): Promise<TeamDetail> {
    return this.teams.create(rlsContextFromPrincipal(principal), dto);
  }

  @Get('teams/:id')
  @RequirePermissions(PERMISSION.teamRead)
  @ApiOperation({ summary: 'A client team with its people and clients' })
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TeamDetail> {
    return this.teams.get(rlsContextFromPrincipal(principal), id);
  }

  @Patch('teams/:id')
  @RequirePermissions(PERMISSION.teamManage)
  @ApiOperation({ summary: 'Rename a team or change its office or note' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeamDto,
  ): Promise<TeamDetail> {
    return this.teams.update(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post('teams/:id/members')
  @RequirePermissions(PERMISSION.teamManage)
  @ApiOperation({ summary: 'Add associates, or set the overseeing partner' })
  addMembers(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTeamMembersDto,
  ): Promise<TeamDetail> {
    return this.teams.addMembers(rlsContextFromPrincipal(principal), id, dto);
  }

  @Delete('teams/:id/members/:employeeId')
  @RequirePermissions(PERMISSION.teamManage)
  @ApiOperation({ summary: 'Remove someone (the overseeing partner needs a replacement)' })
  removeMember(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query('replacementId') replacementId?: string,
  ): Promise<TeamDetail> {
    return this.teams.removeMember(
      rlsContextFromPrincipal(principal),
      id,
      employeeId,
      replacementId && /^[0-9a-f-]{36}$/i.test(replacementId) ? replacementId : undefined,
    );
  }

  @Post('teams/:id/clients')
  @RequirePermissions(PERMISSION.teamManage)
  @ApiOperation({ summary: 'Assign clients to the team (moves them from any other team)' })
  assignClients(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTeamClientsDto,
  ): Promise<AssignTeamClientsResult> {
    return this.teams.assignClients(rlsContextFromPrincipal(principal), id, dto.entityIds);
  }

  @Post('teams/:id/archive')
  @RequirePermissions(PERMISSION.teamManage)
  @ApiOperation({ summary: 'Archive a team that no longer serves any client' })
  archive(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TeamDetail> {
    return this.teams.archive(rlsContextFromPrincipal(principal), id);
  }

  @Put('entities/:id/team')
  @RequirePermissions(PERMISSION.teamManage)
  @ApiOperation({ summary: "Set or clear a client's team" })
  setClientTeam(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetClientTeamDto,
  ): Promise<SetClientTeamResult> {
    return this.teams.setClientTeam(rlsContextFromPrincipal(principal), id, dto);
  }
}
