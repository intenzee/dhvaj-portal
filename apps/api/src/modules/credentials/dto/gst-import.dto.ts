import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBase64, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { GstImportMapping } from '@hsdg/contracts';

export class GstImportDto {
  @ApiProperty({ example: 'GST clients.xlsx' })
  @IsString()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({
    description: 'The .xlsx / .xls / .csv file, base64. Read in memory, never stored.',
  })
  @IsBase64()
  @MinLength(4)
  contentBase64!: string;

  @ApiProperty({ example: 'DEL', description: 'The office new clients belong to' })
  @IsString()
  @MaxLength(20)
  officeCode!: string;

  @ApiPropertyOptional({ description: 'Field → header overrides for the detected mapping' })
  @IsOptional()
  @IsObject()
  mapping?: Partial<GstImportMapping>;
}
