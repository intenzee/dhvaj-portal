import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Ravi Kumar' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  displayName?: string;

  @ApiPropertyOptional({ example: 'SOUTH', description: 'Move to this office code.' })
  @IsOptional()
  @Matches(/^[A-Z0-9_-]{2,20}$/)
  officeCode?: string;

  @ApiPropertyOptional({ description: 'Activate or deactivate the user (soft — never deleted).' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Require MFA for this user.' })
  @IsOptional()
  @IsBoolean()
  mfaRequired?: boolean;
}
