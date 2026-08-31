import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, ValidateIf } from 'class-validator';
import {
  EXCHANGES,
  LISTING_LINE_STATUSES,
  SECURITY_TYPES,
  type Exchange,
  type ListingLineStatus,
  type SecurityType,
} from '@hsdg/contracts';

export class ListingDto {
  @ApiProperty({ enum: EXCHANGES, example: 'nse' })
  @IsIn(EXCHANGES)
  exchange!: Exchange;

  @ApiPropertyOptional({ enum: SECURITY_TYPES, default: 'equity' })
  @IsOptional()
  @IsIn(SECURITY_TYPES)
  securityType?: SecurityType;

  @ApiPropertyOptional({ example: '2021-03-15' })
  @IsOptional()
  @IsDateString()
  listingDate?: string;

  @ApiPropertyOptional({ enum: LISTING_LINE_STATUSES, default: 'listed' })
  @IsOptional()
  @IsIn(LISTING_LINE_STATUSES)
  status?: ListingLineStatus;

  @ApiPropertyOptional({ example: 'ACME' })
  @IsOptional()
  @IsString()
  symbol?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateListingDto {
  @ApiPropertyOptional({ enum: SECURITY_TYPES })
  @IsOptional()
  @IsIn(SECURITY_TYPES)
  securityType?: SecurityType;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  listingDate?: string | null;

  @ApiPropertyOptional({ enum: LISTING_LINE_STATUSES })
  @IsOptional()
  @IsIn(LISTING_LINE_STATUSES)
  status?: ListingLineStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  symbol?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  notes?: string | null;
}
