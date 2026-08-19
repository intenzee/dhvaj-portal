import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Resolve an open review point. */
export class ResolveReviewPointDto {
  @ApiProperty({ description: 'How the review point was resolved.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  resolution!: string;
}
