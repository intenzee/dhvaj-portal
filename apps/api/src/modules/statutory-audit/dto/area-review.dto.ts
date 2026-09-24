import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AREA_ATTENTIONS,
  AREA_COMMENT_KINDS,
  AREA_TYPES,
  FINANCIAL_UNITS,
  REMOVAL_REASON_CODES,
  type AddCustomAreaInput,
  type AddLibraryAreasInput,
  type AreaAttention,
  type AreaCommentInput,
  type AreaCommentKind,
  type AreaLinkInput,
  type AreaType,
  type AssertionActionInput,
  type CompleteAreaReviewInput,
  type FinancialUnit,
  type RemovalReasonCode,
  type RemoveAuditAreaInput,
  type ReopenAreaReviewInput,
  type RespondAreaCommentInput,
  type RestoreAuditAreaInput,
  type SignalResolutionInput,
  type UpdateAuditAreaInput,
} from '@hsdg/contracts';

export class RemoveAuditAreaDto implements RemoveAuditAreaInput {
  @ApiProperty({ enum: REMOVAL_REASON_CODES })
  @IsIn(REMOVAL_REASON_CODES as unknown as string[])
  reasonCode!: RemovalReasonCode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reasonText?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  coveredUnderAreaId?: string | null;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

export class RestoreAuditAreaDto implements RestoreAuditAreaInput {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

export class AddLibraryAreasDto implements AddLibraryAreasInput {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  libraryAreaIds!: string[];
}

export class AddCustomAreaDto implements AddCustomAreaInput {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: AREA_TYPES })
  @IsIn(AREA_TYPES as unknown as string[])
  areaType!: AreaType;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  signalIds?: string[];
}

export class UpdateAuditAreaDto implements UpdateAuditAreaInput {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ enum: AREA_ATTENTIONS })
  @IsOptional()
  @IsIn(AREA_ATTENTIONS as unknown as string[])
  attention?: AreaAttention;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  attentionReason?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cyAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  pyAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string | null;

  @ApiPropertyOptional({ enum: FINANCIAL_UNITS })
  @IsOptional()
  @IsIn(FINANCIAL_UNITS)
  unit?: FinancialUnit | null;

  @ApiPropertyOptional({ enum: ['manual', 'other'] })
  @IsOptional()
  @IsIn(['manual', 'other'])
  amountSource?: 'manual' | 'other' | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  amountNote?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  planningOwnerEmployeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  inconsistencyResolution?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolveReviewFlag?: string | null;
}

export class AssertionActionDto implements AssertionActionInput {
  @ApiProperty({ enum: ['add', 'remove', 'restore', 'set_attention'] })
  @IsIn(['add', 'remove', 'restore', 'set_attention'])
  action!: AssertionActionInput['action'];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string | null;

  @ApiPropertyOptional({ enum: AREA_ATTENTIONS })
  @IsOptional()
  @IsIn(AREA_ATTENTIONS as unknown as string[])
  attention?: AreaAttention;
}

export class AreaLinkDto implements AreaLinkInput {
  @ApiProperty({ enum: ['link', 'unlink'] })
  @IsIn(['link', 'unlink'])
  action!: 'link' | 'unlink';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  signalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  specificKey?: string;
}

export class SignalResolutionDto implements SignalResolutionInput {
  @ApiProperty()
  @IsUUID()
  signalId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note!: string | null;
}

export class CompleteAreaReviewDto implements CompleteAreaReviewInput {
  @ApiProperty()
  @IsBoolean()
  confirm!: boolean;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

export class ReopenAreaReviewDto implements ReopenAreaReviewInput {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  reason!: string;
}

export class AreaCommentDto implements AreaCommentInput {
  @ApiProperty({ enum: AREA_COMMENT_KINDS })
  @IsIn(AREA_COMMENT_KINDS as unknown as string[])
  kind!: AreaCommentKind;

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  body!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  areaId?: string | null;
}

export class RespondAreaCommentDto implements RespondAreaCommentInput {
  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  response!: string;
}
