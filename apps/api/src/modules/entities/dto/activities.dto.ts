import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** Yes/no business-activity flags (§18). */
export class ActivitiesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() manufacturing?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trading?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() services?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() import?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() export?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() ecommerce?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() regulated?: boolean;
}
