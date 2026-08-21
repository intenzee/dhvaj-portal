import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class UpdateOfficeDto {
  @ApiPropertyOptional({ example: 'Mumbai (West)' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ description: 'Activate or deactivate the office.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
