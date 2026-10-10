import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FRAMEWORK_EVIDENCE_KEY_PATTERN, type FrameworkEvidenceKey } from '@hsdg/contracts';
import {
  IsBase64,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class AddFrameworkFileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  filename!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contentType?: string;

  @ApiProperty({ description: 'File bytes, base64-encoded.' })
  @IsBase64()
  contentBase64!: string;

  @ApiPropertyOptional({
    pattern: FRAMEWORK_EVIDENCE_KEY_PATTERN.source,
    description: 'Checklist question (frf_02 …) or 02.6 relationship (rel_<hex>).',
  })
  @IsOptional()
  @Matches(FRAMEWORK_EVIDENCE_KEY_PATTERN)
  questionKey?: FrameworkEvidenceKey;
}

export class LinkFrameworkFileDto {
  @ApiProperty({ description: 'An engagement document — linked, never copied.' })
  @IsUUID()
  documentId!: string;

  @ApiPropertyOptional({
    pattern: FRAMEWORK_EVIDENCE_KEY_PATTERN.source,
    description: 'Checklist question (frf_02 …) or 02.6 relationship (rel_<hex>).',
  })
  @IsOptional()
  @Matches(FRAMEWORK_EVIDENCE_KEY_PATTERN)
  questionKey?: FrameworkEvidenceKey;
}

export class CreateFrameworkMemoDto {
  @ApiPropertyOptional({ description: 'Use this template variant instead of the applicable one.' })
  @IsOptional()
  @Matches(/^[a-z0-9_]{2,40}$/)
  variantKey?: string;
}
