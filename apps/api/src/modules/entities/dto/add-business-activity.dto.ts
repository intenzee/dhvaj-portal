import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

export class BusinessActivityDto {
  @ApiProperty({ example: 'manufacturing', description: 'Industry master slug.' })
  @IsString()
  industrySlug!: string;

  @ApiPropertyOptional({ example: '25999', description: 'NIC code (if known).' })
  @IsOptional()
  @Matches(/^[0-9]{2,5}$/, { message: 'nicCode must be 2–5 digits' })
  nicCode?: string;

  @ApiPropertyOptional({ default: false, description: 'Primary industry (one per entity).' })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
