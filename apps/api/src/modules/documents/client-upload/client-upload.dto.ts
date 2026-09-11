import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBase64,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateUploadLinkDto {
  @ApiPropertyOptional({ description: 'Validity in hours (defaults to the configured TTL).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  ttlHours?: number;

  @ApiPropertyOptional({ description: 'Max uploads allowed via this link (0 = unlimited).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  maxUploads?: number;
}

export class ClientUploadDto {
  @ApiPropertyOptional({ description: 'Optional title; defaults to the file name.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @ApiProperty({ description: 'Original file name.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  filename!: string;

  @ApiPropertyOptional({ description: 'MIME type; defaults to application/octet-stream.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contentType?: string;

  @ApiProperty({ description: 'File bytes, base64-encoded.' })
  @IsBase64()
  contentBase64!: string;
}
