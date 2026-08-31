import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { REGULATORY_ATTRIBUTE_SOURCES, type RegulatoryAttributeSource } from '@hsdg/contracts';

/**
 * A single structured regulatory FACT (§19) — never a conclusion. attributeCode
 * must exist in the entity_regulatory_attribute_defs catalogue; the value goes in
 * the typed field matching that code's value_kind (enforced by the def catalogue).
 */
export class RegulatoryAttributeDto {
  @ApiProperty({ example: 'regulated_sector' })
  @IsString()
  attributeCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  valueText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  valueNumber?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  valueBoolean?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  valueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional({ enum: REGULATORY_ATTRIBUTE_SOURCES, default: 'client' })
  @IsOptional()
  @IsIn(REGULATORY_ATTRIBUTE_SOURCES)
  source?: RegulatoryAttributeSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
