import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBase64,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ACCEPTANCE_FILE_STATUSES, type AcceptanceFileStatus } from '@hsdg/contracts';

const SLOT_KEY = /^[a-z_]{2,40}(:[a-z0-9_]{2,60})?$/;

export class CreateAcceptanceFileFromTemplateDto {
  @ApiProperty({ example: 'engagement_letter' })
  @Matches(SLOT_KEY)
  slotKey!: string;

  @ApiPropertyOptional({ description: 'Use this variant instead of the applicable one.' })
  @IsOptional()
  @Matches(/^[a-z0-9_]{2,40}$/)
  variantKey?: string;
}

export class AddAcceptanceFileDto {
  @ApiProperty({ example: 'evidence:app_04' })
  @Matches(SLOT_KEY)
  slotKey!: string;

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
}

export class LinkAcceptanceFileDto {
  @ApiProperty()
  @Matches(SLOT_KEY)
  slotKey!: string;

  @ApiProperty({ description: 'An existing document on this engagement (linked, never copied).' })
  @IsUUID()
  documentId!: string;
}

export class SetAcceptanceFileStatusDto {
  @ApiProperty({ enum: ACCEPTANCE_FILE_STATUSES })
  @IsIn(ACCEPTANCE_FILE_STATUSES)
  status!: AcceptanceFileStatus;

  @ApiPropertyOptional({
    description:
      'Details recorded with the step (sentDate, sentMode, issuedDate, deliveryMode, acceptedDate, remarks, reopenReason).',
  })
  @IsOptional()
  @IsObject()
  meta?: Record<string, string | null>;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}
