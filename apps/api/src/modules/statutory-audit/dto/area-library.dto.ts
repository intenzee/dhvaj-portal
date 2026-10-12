import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AREA_ATTENTIONS,
  AREA_CATEGORIES,
  AREA_CONDITION_KEYS,
  AREA_TYPES,
  ASSERTION_IDS,
  type AreaAttention,
  type AreaCategory,
  type AreaConditionKey,
  type AreaType,
  type AssertionId,
  type CreateLibraryDraftInput,
  type UpsertLibraryAreaInput,
} from '@hsdg/contracts';

export class CreateLibraryDraftDto implements CreateLibraryDraftInput {
  @ApiProperty({ example: 'dhvaj-gc-2026.3' })
  @IsString()
  @MaxLength(60)
  libraryVersion!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  note!: string;
}

export class UpsertLibraryAreaDto implements UpsertLibraryAreaInput {
  @ApiProperty()
  @IsString()
  @MaxLength(20)
  areaCode!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  areaName!: string;

  @ApiProperty({ enum: AREA_TYPES })
  @IsIn(AREA_TYPES as unknown as string[])
  areaType!: AreaType;

  @ApiProperty({ enum: AREA_CATEGORIES })
  @IsIn(AREA_CATEGORIES as unknown as string[])
  category!: AreaCategory;

  @ApiProperty({ enum: ['both', 'as', 'ind_as'] })
  @IsIn(['both', 'as', 'ind_as'])
  frameworkProfile!: 'both' | 'as' | 'ind_as';

  @ApiProperty({ example: 'general_corporate' })
  @IsString()
  @MaxLength(42)
  industryProfile!: string;

  @ApiPropertyOptional({ enum: AREA_CONDITION_KEYS })
  @IsOptional()
  @IsIn(AREA_CONDITION_KEYS as unknown as string[])
  conditionKey!: AreaConditionKey | null;

  @ApiProperty({ enum: ASSERTION_IDS, isArray: true })
  @IsArray()
  @ArrayMaxSize(13)
  @IsIn(ASSERTION_IDS as unknown as string[], { each: true })
  defaultAssertions!: AssertionId[];

  @ApiProperty()
  @IsBoolean()
  nonAssertionWorkstream!: boolean;

  @ApiProperty({ enum: AREA_ATTENTIONS })
  @IsIn(AREA_ATTENTIONS as unknown as string[])
  defaultAttention!: AreaAttention;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  relatedAuthorities!: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  signalMappingTags!: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  metricKeys!: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  indicatorTags!: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  aliases!: string[];

  @ApiProperty({ example: '2026-04-01' })
  @IsString()
  @MaxLength(10)
  effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  effectiveTo!: string | null;

  @ApiProperty()
  @IsBoolean()
  active!: boolean;

  @ApiProperty()
  @IsInt()
  @Min(0)
  sortOrder!: number;
}
