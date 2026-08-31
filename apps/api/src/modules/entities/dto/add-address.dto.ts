import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { ADDRESS_TYPES, type AddressType } from '@hsdg/contracts';

export class AddressDto {
  @ApiPropertyOptional({ enum: ADDRESS_TYPES, default: 'registered' })
  @IsOptional()
  @IsIn(ADDRESS_TYPES)
  addressType?: AddressType;

  @ApiProperty({ example: '1 Industrial Estate' })
  @IsString()
  line1!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  line2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: '400001' })
  @IsOptional()
  @Matches(/^[0-9]{6}$/, { message: 'pincode must be 6 digits' })
  pincode?: string;

  @ApiPropertyOptional({ example: 'IN', default: 'IN' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter code' })
  country?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/** Partial update — every field optional; nullable ones may be cleared. */
export class UpdateAddressDto {
  @ApiPropertyOptional({ enum: ADDRESS_TYPES })
  @IsOptional()
  @IsIn(ADDRESS_TYPES)
  addressType?: AddressType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  line1?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  line2?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  city?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  state?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(/^[0-9]{6}$/, { message: 'pincode must be 6 digits' })
  pincode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter code' })
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
