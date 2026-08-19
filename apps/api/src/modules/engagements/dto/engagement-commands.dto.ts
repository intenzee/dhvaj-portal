import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { TEAM_ROLES, type TeamRole } from '@hsdg/contracts';

export class ReassignPartnerDto {
  @ApiProperty({ description: 'New Engagement Partner employee id.' })
  @IsUUID()
  engagementPartnerEmployeeId!: string;

  @ApiPropertyOptional({ description: 'Reason for the change (recorded in the audit trail).' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class AssignTeamMemberDto {
  @ApiProperty({ description: 'Employee id to assign.' })
  @IsUUID()
  employeeId!: string;

  @ApiPropertyOptional({ enum: TEAM_ROLES, default: 'member' })
  @IsOptional()
  @IsIn(TEAM_ROLES)
  roleOnEngagement?: TeamRole;
}
