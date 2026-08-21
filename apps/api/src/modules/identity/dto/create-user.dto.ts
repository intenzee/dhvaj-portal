import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { ASSIGNABLE_ROLES, type RoleSlug } from '@hsdg/contracts';

export class CreateUserDto {
  @ApiProperty({ example: 'ravi.kumar@hsdg.in', description: 'Login email (unique).' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Ravi Kumar' })
  @IsString()
  @Length(1, 200)
  displayName!: string;

  @ApiProperty({ example: 'NORTH', description: 'Primary office code.' })
  @Matches(/^[A-Z0-9_-]{2,20}$/)
  officeCode!: string;

  @ApiPropertyOptional({ default: false, description: 'Require MFA for this user.' })
  @IsOptional()
  @IsBoolean()
  mfaRequired?: boolean;

  @ApiPropertyOptional({
    isArray: true,
    enum: ASSIGNABLE_ROLES,
    description: 'Roles to grant on creation.',
  })
  @IsOptional()
  @ArrayUnique()
  @IsIn(ASSIGNABLE_ROLES, { each: true })
  roles?: RoleSlug[];
}
