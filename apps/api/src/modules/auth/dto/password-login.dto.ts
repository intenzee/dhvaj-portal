import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';

/** Email + password sign-in. */
export class PasswordLoginDto {
  @ApiProperty({ example: 'ravi.kumar@dhvaj.in' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'The portal password (or the temporary one an admin gave).' })
  @IsString()
  @MaxLength(200)
  password!: string;
}

/** The person replaces their password — the temporary one, or their own. */
export class ChangePasswordDto {
  @ApiProperty({ example: 'ravi.kumar@dhvaj.in' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'The current (or temporary) password.' })
  @IsString()
  @MaxLength(200)
  currentPassword!: string;

  @ApiProperty({ description: 'The new password: at least 10 characters.' })
  @IsString()
  @MaxLength(200)
  newPassword!: string;
}
