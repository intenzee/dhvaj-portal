import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class CreateOfficeDto {
  @ApiProperty({ example: 'WEST', description: 'Unique office code (A–Z, 0–9, -, _; 2–20 chars).' })
  @Matches(/^[A-Z0-9_-]{2,20}$/)
  code!: string;

  @ApiProperty({ example: 'Mumbai (West)' })
  @IsString()
  @Length(1, 200)
  name!: string;
}
