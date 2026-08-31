import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  RELATIONSHIP_STATUSES,
  RELATIONSHIP_TYPES,
  type RelationshipStatus,
  type RelationshipType,
} from '@hsdg/contracts';

export class RelationshipDto {
  @ApiProperty({ description: 'The related (target) entity id.' })
  @IsUUID()
  toEntityId!: string;

  @ApiProperty({ enum: RELATIONSHIP_TYPES, example: 'subsidiary' })
  @IsIn(RELATIONSHIP_TYPES)
  relationshipType!: RelationshipType;

  @ApiPropertyOptional({ example: 51, description: 'Shareholding / interest %.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  shareholdingPct?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  effectiveFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  effectiveTo?: string;

  @ApiPropertyOptional({ enum: RELATIONSHIP_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(RELATIONSHIP_STATUSES)
  status?: RelationshipStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateRelationshipDto {
  @ApiPropertyOptional({ enum: RELATIONSHIP_TYPES })
  @IsOptional()
  @IsIn(RELATIONSHIP_TYPES)
  relationshipType?: RelationshipType;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  shareholdingPct?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  effectiveFrom?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  effectiveTo?: string | null;

  @ApiPropertyOptional({ enum: RELATIONSHIP_STATUSES })
  @IsOptional()
  @IsIn(RELATIONSHIP_STATUSES)
  status?: RelationshipStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  notes?: string | null;
}
