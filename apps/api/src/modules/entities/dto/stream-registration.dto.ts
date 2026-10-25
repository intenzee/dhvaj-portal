import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { GSTIN_REGEX, PENDING_REGISTRATION_STREAMS, type Stream } from '@hsdg/contracts';

export class StreamRegistrationParamDto {
  @IsUUID()
  id!: string;

  @IsIn(PENDING_REGISTRATION_STREAMS)
  stream!: Stream;
}

/** The GSTIN a GST stream has been waiting on, entered from the engagement. */
export class StreamRegistrationDto {
  @ApiProperty({ example: '27AAACA1234A1Z5' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(GSTIN_REGEX, {
    message: 'That is not a valid GSTIN (15 characters, e.g. 27AAACA1234A1Z5).',
  })
  registrationNumber!: string;

  @ApiPropertyOptional({ example: '27', description: 'Defaults to the GSTIN’s first two digits.' })
  @IsOptional()
  @Matches(/^[0-9]{2}$/)
  stateCode?: string;
}
