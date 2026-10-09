import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import type { CreateFsWorkbookInput } from '@hsdg/contracts';

export class CreateFsWorkbookDto implements CreateFsWorkbookInput {
  @ApiPropertyOptional({ description: 'Use this template variant instead of the applicable one.' })
  @IsOptional()
  @Matches(/^[a-z0-9_]{2,40}$/)
  variantKey?: string;
}
