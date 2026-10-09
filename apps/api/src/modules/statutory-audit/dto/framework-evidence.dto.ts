import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FRAMEWORK_EVIDENCE_QUESTIONS, type FrameworkEvidenceQuestion } from '@hsdg/contracts';
import {
  IsBase64,
  IsIn,
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

  @ApiPropertyOptional({ enum: FRAMEWORK_EVIDENCE_QUESTIONS, description: 'Checklist question.' })
  @IsOptional()
  @IsIn(FRAMEWORK_EVIDENCE_QUESTIONS)
  questionKey?: FrameworkEvidenceQuestion;
}

export class LinkFrameworkFileDto {
  @ApiProperty({ description: 'An engagement document — linked, never copied.' })
  @IsUUID()
  documentId!: string;

  @ApiPropertyOptional({ enum: FRAMEWORK_EVIDENCE_QUESTIONS, description: 'Checklist question.' })
  @IsOptional()
  @IsIn(FRAMEWORK_EVIDENCE_QUESTIONS)
  questionKey?: FrameworkEvidenceQuestion;
}

export class CreateFrameworkMemoDto {
  @ApiPropertyOptional({ description: 'Use this template variant instead of the applicable one.' })
  @IsOptional()
  @Matches(/^[a-z0-9_]{2,40}$/)
  variantKey?: string;
}
