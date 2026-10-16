import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min, ValidateIf } from 'class-validator';
import { GSTIN_REGEX } from '@hsdg/contracts';

/** PS-201 · Billing → Settings. */
export class UpdateBillingSettingsDto {
  @ApiProperty({ description: 'The version read; a stale one is a 409.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ description: "The firm's GSTIN; its first two digits are the state." })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(GSTIN_REGEX, { message: 'gstin is not a valid GSTIN.' })
  gstin?: string | null;

  @ApiPropertyOptional({ example: '07' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{2}$/, { message: 'stateCode must be a two-digit GST state code.' })
  stateCode?: string | null;

  @ApiPropertyOptional({ example: '998221' })
  @IsOptional()
  @Matches(/^\d{4,8}$/, { message: 'sacDefault must be a 4–8 digit SAC.' })
  sacDefault?: string;

  @ApiPropertyOptional({ example: 'INV', description: '1–5 capitals or digits.' })
  @IsOptional()
  @Matches(/^[A-Z0-9]{1,5}$/, { message: 'invoicePrefix must be 1–5 capitals or digits.' })
  invoicePrefix?: string;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  invoiceTermsDays?: number;
}
