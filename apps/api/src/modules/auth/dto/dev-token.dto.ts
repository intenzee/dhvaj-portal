import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional } from 'class-validator';

/** Request body for minting a development access token. */
export class DevTokenDto {
  @ApiProperty({ example: 'partner.a@hsdg.in', description: 'A seeded user email.' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'Whether the minted token asserts MFA was satisfied. Set false to test MFA enforcement against an MFA-required user.',
  })
  @IsOptional()
  @IsBoolean()
  mfa?: boolean;
}
