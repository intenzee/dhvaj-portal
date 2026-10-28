import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { PENDING_REGISTRATION_STREAMS, type Stream } from '@hsdg/contracts';

export class StreamRegistrationParamDto {
  @IsUUID()
  id!: string;

  @IsIn(PENDING_REGISTRATION_STREAMS)
  stream!: Stream;
}

/** The GSTIN (GST) or TAN (TDS) a stream has been waiting on, entered from the engagement. */
export class StreamRegistrationDto {
  @ApiProperty({ example: '27AAACA1234A1Z5', description: 'A GSTIN for GST, a TAN for TDS.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @MaxLength(15)
  registrationNumber!: string;

  @ApiPropertyOptional({
    example: '27',
    description: 'GST only; defaults to the GSTIN’s first two digits.',
  })
  @IsOptional()
  @Matches(/^[0-9]{2}$/)
  stateCode?: string;
}
