import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  ARTICLESHIP_END_STATUSES,
  ARTICLESHIP_LEAVE_KINDS,
  ARTICLESHIP_STATUSES,
  type AddArticleshipLeaveInput,
  type ArticleshipLeaveKind,
  type ArticleshipStatus,
  type EndArticleshipInput,
  type SaveArticleshipInput,
  type UpdateArticleshipSchemeInput,
} from '@hsdg/contracts';

export class ArticleshipListQueryDto {
  @ApiPropertyOptional({ enum: ARTICLESHIP_STATUSES })
  @IsOptional()
  @IsIn(ARTICLESHIP_STATUSES)
  status?: ArticleshipStatus;
}

export class SaveArticleshipDto implements SaveArticleshipInput {
  @ApiProperty({ description: 'The principal (a partner).' })
  @IsUUID()
  principalEmployeeId!: string;

  @ApiProperty({ example: 'three_year' })
  @IsString()
  @MaxLength(40)
  schemeCode!: string;

  @ApiPropertyOptional({ nullable: true, example: 'WRO0123456' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(40)
  icaiRegistrationNo?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString({ strict: true })
  icaiRegistrationDate?: string | null;

  @ApiProperty({ example: '2026-07-01' })
  @IsDateString({ strict: true })
  startDate!: string;

  @ApiPropertyOptional({ description: 'Defaults to the start plus the scheme’s period.' })
  @IsOptional()
  @IsDateString({ strict: true })
  expectedCompletion?: string;

  @ApiPropertyOptional({ nullable: true, description: 'This article’s own leave allowance.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  leaveEntitlementDays?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Transferred in from (principal / firm).' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(300)
  transferredFrom?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class EndArticleshipDto implements EndArticleshipInput {
  @ApiProperty({ enum: ARTICLESHIP_END_STATUSES })
  @IsIn(ARTICLESHIP_END_STATUSES)
  status!: EndArticleshipInput['status'];

  @ApiProperty({ example: '2029-06-30' })
  @IsDateString({ strict: true })
  endedOn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class AddArticleshipLeaveDto implements AddArticleshipLeaveInput {
  @ApiProperty({ example: '2026-11-02' })
  @IsDateString({ strict: true })
  fromDate!: string;

  @ApiProperty({ example: '2026-11-04' })
  @IsDateString({ strict: true })
  toDate!: string;

  @ApiProperty({ example: 3, description: 'Days, in halves (0.5).' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0.5)
  @Max(366)
  days!: number;

  @ApiProperty({ enum: ARTICLESHIP_LEAVE_KINDS })
  @IsIn(ARTICLESHIP_LEAVE_KINDS)
  kind!: ArticleshipLeaveKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateArticleshipSchemeDto implements UpdateArticleshipSchemeInput {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  periodMonths?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  leaveEntitlementDays?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
