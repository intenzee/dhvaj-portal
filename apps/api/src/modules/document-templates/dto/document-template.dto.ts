import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBase64,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DOCUMENT_TEMPLATE_KEYS, type DocumentTemplateKey } from '@hsdg/contracts';

/** When a variant applies (every condition set must hold). */
export class TemplateConditionsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  listed?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  entityTypeSlugs?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasGroup?: boolean;
}

export class CreateTemplateVariantDto {
  @ApiProperty({ enum: DOCUMENT_TEMPLATE_KEYS })
  @IsIn(DOCUMENT_TEMPLATE_KEYS)
  templateKey!: DocumentTemplateKey;

  @ApiProperty({ example: 'listed_company' })
  @Matches(/^[a-z0-9_]{2,40}$/)
  variantKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ type: TemplateConditionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateConditionsDto)
  appliesWhen?: TemplateConditionsDto;
}

export class UpdateTemplateVariantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ type: TemplateConditionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateConditionsDto)
  appliesWhen?: TemplateConditionsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

export class UploadTemplateVersionDto {
  @ApiProperty({ example: 'Engagement Letter v3.docx' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  filename!: string;

  @ApiProperty({ description: 'The .docx bytes, base64-encoded.' })
  @IsBase64()
  contentBase64!: string;

  @ApiPropertyOptional({ description: 'What changed in this version.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateFirmSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  firmName?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Firm registration number (FRN).' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  frn?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  address?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsEmail()
  email?: string | null;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}
