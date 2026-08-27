import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { ENGAGEMENT_ENTITY_ROLES, type EngagementEntityRole } from '@hsdg/contracts';

/** Add an entity to a multi-entity / group engagement's coverage (§30). */
export class AddCoveredEntityDto {
  @ApiProperty({ description: 'Entity id to add to the engagement coverage.' })
  @IsUUID()
  entityId!: string;

  @ApiPropertyOptional({ enum: ENGAGEMENT_ENTITY_ROLES, default: 'covered' })
  @IsOptional()
  @IsIn(ENGAGEMENT_ENTITY_ROLES)
  role?: EngagementEntityRole;
}
