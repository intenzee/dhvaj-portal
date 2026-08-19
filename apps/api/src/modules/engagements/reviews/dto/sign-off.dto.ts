import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Perform the terminal sign-off. Authority is governed by the effective review model. */
export class SignOffDto {
  @ApiPropertyOptional({ description: 'Sign-off notes recorded in the review trail.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Expected current version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
