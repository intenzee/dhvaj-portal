import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { CLIENT_TEAM_NAME_MAX, CLIENT_TEAM_ROLES, type ClientTeamRole } from '@hsdg/contracts';

/** POST /teams */
export class CreateTeamDto {
  @ApiProperty({ maxLength: CLIENT_TEAM_NAME_MAX })
  @IsString()
  @MaxLength(CLIENT_TEAM_NAME_MAX)
  name!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  overseeingPartnerId!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  associateIds?: string[];

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  officeId?: string | null;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsUUID('all', { each: true })
  entityIds?: string[];
}

/** PATCH /teams/:id */
export class UpdateTeamDto {
  @ApiPropertyOptional({ maxLength: CLIENT_TEAM_NAME_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(CLIENT_TEAM_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  officeId?: string | null;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** POST /teams/:id/members */
export class AddTeamMembersDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  employeeIds!: string[];

  @ApiProperty({ enum: CLIENT_TEAM_ROLES })
  @IsIn(CLIENT_TEAM_ROLES)
  teamRole!: ClientTeamRole;
}

/** POST /teams/:id/clients */
export class AssignTeamClientsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsUUID('all', { each: true })
  entityIds!: string[];
}

/** PUT /entities/:id/team */
export class SetClientTeamDto {
  @ApiProperty({ format: 'uuid', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  teamId!: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  applyToOpenEngagements?: boolean;
}
