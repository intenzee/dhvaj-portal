import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import type { ApplyDataCheckInput } from '@hsdg/contracts';

/** POST /entities/data-checks/:check/apply — the reviewed clients to fix (CM-9). */
export class ApplyDataCheckDto implements ApplyDataCheckInput {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  entityIds!: string[];

  @ApiPropertyOptional({ enum: ['apply', 'keep'] })
  @IsOptional()
  @IsIn(['apply', 'keep'])
  action?: 'apply' | 'keep';

  @ApiPropertyOptional({ format: 'uuid', description: 'client_without_team: the team to assign.' })
  @IsOptional()
  @IsUUID('all')
  teamId?: string;
}

/** GET /entities/data-checks/:check?page= */
export class DataCheckPageDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
