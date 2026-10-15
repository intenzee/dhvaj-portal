import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ROLLOUT_MODES, type RolloutMode } from '@hsdg/contracts';

export class UpdateFeatureRolloutDto {
  @ApiProperty({ enum: ROLLOUT_MODES })
  @IsIn(ROLLOUT_MODES)
  mode!: RolloutMode;

  @ApiPropertyOptional({ type: [String], description: "Office codes, for 'offices'." })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Matches(/^[A-Za-z0-9_-]{2,20}$/, { each: true })
  officeCodes?: string[];

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiProperty({ description: 'The version read (0 when the flag follows the deploy).' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}
