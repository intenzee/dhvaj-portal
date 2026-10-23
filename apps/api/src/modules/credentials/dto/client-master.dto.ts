import { ApiProperty } from '@nestjs/swagger';
import { IsBase64, IsString, MaxLength, MinLength } from 'class-validator';

export class ClientMasterDto {
  @ApiProperty({ example: 'DHVAJ-Client-Master.xlsx' })
  @IsString()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({
    description: 'The filled Client Master workbook, base64. Read in memory, never stored.',
  })
  @IsBase64()
  @MinLength(4)
  contentBase64!: string;

  @ApiProperty({
    example: 'DEL',
    description: 'The office of a new client whose row leaves "Home office code" blank',
  })
  @IsString()
  @MaxLength(20)
  officeCode!: string;
}
