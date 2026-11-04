import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  TAX_AUDIT_ACTS,
  TAX_AUDIT_DRAFT_SOURCES,
  TAX_AUDIT_FIELD_KINDS,
  TAX_AUDIT_GRADES,
  TAX_AUDIT_PACKAGES,
  type CreateTaxAuditLibraryDraftInput,
  type TaxAuditAct,
  type TaxAuditCondition,
  type TaxAuditDraftSource,
  type TaxAuditFieldKind,
  type TaxAuditGrade,
  type TaxAuditLibraryClauseInput,
  type TaxAuditPackage,
  type TaxAuditSubItem,
} from '@hsdg/contracts';

const FY = /^[0-9]{4}-[0-9]{2}$/;
const FY_MESSAGE = 'The financial year must look like 2026-27.';

export class TaxAuditSubItemDto implements TaxAuditSubItem {
  @ApiProperty({ example: 'a' })
  @Matches(/^[a-z][a-z0-9_]{0,23}$/, { message: 'A sub-item key is lower case, like a or ba.' })
  key!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  label!: string;

  @ApiProperty({ enum: TAX_AUDIT_FIELD_KINDS })
  @IsIn(TAX_AUDIT_FIELD_KINDS)
  kind!: TaxAuditFieldKind;
}

export class TaxAuditLibraryClauseDto implements TaxAuditLibraryClauseInput {
  @ApiProperty({ example: '21(a)' })
  @Matches(/^[0-9]{1,2}[A-Za-z]?(\([a-z]{1,3}\))?$/, {
    message: 'A clause number looks like 8a, 21(d) or 29A.',
  })
  clauseNo!: string;

  @ApiProperty({ enum: ['A', 'B'] })
  @IsIn(['A', 'B'])
  part!: 'A' | 'B';

  @ApiProperty()
  @IsString()
  @Matches(/\S/, { message: 'Give the clause a title.' })
  @MaxLength(300)
  title!: string;

  @ApiProperty({ type: [TaxAuditSubItemDto] })
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => TaxAuditSubItemDto)
  subItems!: TaxAuditSubItemDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: '{fact, is} | {all: […]} | {any: […]} | {not: …}; null = always applies.',
  })
  @IsOptional()
  @IsObject()
  appliesWhen!: TaxAuditCondition | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notApplicableReason!: string | null;

  @ApiProperty({ enum: TAX_AUDIT_PACKAGES })
  @IsIn(TAX_AUDIT_PACKAGES)
  defaultPackage!: TaxAuditPackage;

  @ApiProperty({ enum: TAX_AUDIT_GRADES })
  @IsIn(TAX_AUDIT_GRADES)
  defaultGrade!: TaxAuditGrade;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  evidence!: string[];

  @ApiPropertyOptional({ enum: TAX_AUDIT_DRAFT_SOURCES, nullable: true })
  @IsOptional()
  @IsIn(TAX_AUDIT_DRAFT_SOURCES)
  draftSource!: TaxAuditDraftSource | null;

  @ApiProperty()
  @IsBoolean()
  partnerReview!: boolean;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sortOrder!: number;
}

export class CreateTaxAuditLibraryDraftDto implements CreateTaxAuditLibraryDraftInput {
  @ApiProperty({ example: 'Form 3CD — Income-tax Rules 1962 (2027 amendment)' })
  @IsString()
  @Matches(/\S/, { message: 'Give the version a name.' })
  @MaxLength(200)
  label!: string;

  @ApiProperty({ enum: TAX_AUDIT_ACTS })
  @IsIn(TAX_AUDIT_ACTS)
  act!: TaxAuditAct;

  @ApiProperty({ example: '2026-27', description: 'The first financial year audited on it.' })
  @Matches(FY, { message: FY_MESSAGE })
  appliesFromFy!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ description: 'Copy this published version (default: the newest).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  basedOnVersionNo?: number;

  @ApiPropertyOptional({
    type: [TaxAuditLibraryClauseDto],
    description: 'A whole version, loaded as data instead of a copy.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => TaxAuditLibraryClauseDto)
  clauses?: TaxAuditLibraryClauseDto[];
}

export class UpdateTaxAuditLibraryDraftDto {
  @ApiProperty()
  @IsString()
  @Matches(/\S/, { message: 'Give the version a name.' })
  @MaxLength(200)
  label!: string;

  @ApiProperty({ enum: TAX_AUDIT_ACTS })
  @IsIn(TAX_AUDIT_ACTS)
  act!: TaxAuditAct;

  @ApiProperty({ example: '2026-27' })
  @Matches(FY, { message: FY_MESSAGE })
  appliesFromFy!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}
