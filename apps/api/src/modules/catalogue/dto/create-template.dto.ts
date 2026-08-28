import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { TEMPLATE_TYPES, type TemplateType } from '@hsdg/contracts';

export class CreateTemplateDto {
  @ApiProperty({ enum: TEMPLATE_TYPES, example: 'checklist' })
  @IsIn(TEMPLATE_TYPES)
  templateType!: TemplateType;

  @ApiProperty({ example: 'CHK_STAT_AUDIT' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9_]{2,50}$/, { message: 'code must be UPPER_SNAKE (A-Z, 0-9, _)' })
  code!: string;

  @ApiProperty({ example: 'Statutory Audit — Planning Checklist' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
