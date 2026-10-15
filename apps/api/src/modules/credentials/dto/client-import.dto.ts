import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBase64, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ClientImportDto {
  @ApiProperty({ example: 'Client GST Login Details.xlsx' })
  @IsString()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({
    description: 'The .xlsx / .xls / .csv workbook, base64. Read in memory, never stored.',
  })
  @IsBase64()
  @MinLength(4)
  contentBase64!: string;

  @ApiProperty({ example: 'DEL', description: 'The office new clients belong to' })
  @IsString()
  @MaxLength(20)
  officeCode!: string;

  @ApiPropertyOptional({
    example: 'proprietorship',
    description: 'The type for new clients whose PAN and name do not say',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  defaultTypeSlug?: string;
}
