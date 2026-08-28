import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class TemplateItemDto {
  @ApiProperty({ example: 'Bank reconciliation prepared' })
  @IsString()
  @MaxLength(500)
  label!: string;

  @ApiPropertyOptional({ description: 'Order within the template; defaults to declaration order.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sequence?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  mandatory?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class AddTemplateVersionDto {
  @ApiProperty({
    example: '2026-04-01',
    description: 'Date this version takes effect (inclusive).',
  })
  @IsISO8601()
  effectiveFrom!: string;

  @ApiPropertyOptional({ description: 'Optional end of the effective window (inclusive).' })
  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @ApiPropertyOptional({ type: [TemplateItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateItemDto)
  items?: TemplateItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
