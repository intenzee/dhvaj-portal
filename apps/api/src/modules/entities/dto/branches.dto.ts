import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

class CombineOtherDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  entityId!: string;
}

class CombineOfficeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  registrationId!: string;

  @ApiProperty({ maxLength: 80 })
  @IsString()
  @Length(1, 80)
  label!: string;

  @ApiProperty()
  @IsBoolean()
  isHeadOffice!: boolean;
}

/** POST /entities/:id/combine-branches — CM-6. */
export class CombineBranchesDto {
  @ApiProperty({ type: [CombineOtherDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CombineOtherDto)
  others!: CombineOtherDto[];

  @ApiProperty({ type: [CombineOfficeDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CombineOfficeDto)
  offices!: CombineOfficeDto[];

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  legalName?: string;
}

/** POST /entities/:id/branches */
export class AddBranchDto {
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @Length(1, 80)
  label!: string;

  @ApiPropertyOptional({ example: '07' })
  @IsOptional()
  @Matches(/^[0-9]{2}$/)
  stateCode?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  registrationId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isHeadOffice?: boolean;
}

/** PATCH /entities/:id/branches/:branchId */
export class UpdateBranchDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isHeadOffice?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  version?: number;
}
