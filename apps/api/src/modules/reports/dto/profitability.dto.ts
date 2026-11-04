import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PROFITABILITY_BY,
  type ProfitabilityBy,
  type ProfitabilityQuery,
  type PutEmployeeRateInput,
  type PutRateCardsInput,
  type PutWorkingCalendarInput,
} from '@hsdg/contracts';
import { IsDateOnly } from '../../registers/dto/registers.dto';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const IsRate = () => Matches(MONEY, { message: '$property must be rupees, like 1500 or 1500.50' });

export class ProfitabilityQueryDto implements ProfitabilityQuery {
  @ApiPropertyOptional({ description: 'From (IST date); the last full quarter by default.' })
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateOnly()
  to?: string;

  @ApiPropertyOptional({ enum: PROFITABILITY_BY })
  @IsOptional()
  @IsIn(PROFITABILITY_BY)
  by?: ProfitabilityBy;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  officeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  entityId?: string;
}

class GradeRateDto {
  @ApiProperty()
  @IsUUID()
  gradeId!: string;

  @ApiProperty({ example: '800' })
  @IsRate()
  costRatePerHour!: string;

  @ApiProperty({ example: '2500' })
  @IsRate()
  chargeOutRatePerHour!: string;
}

export class PutRateCardsDto implements PutRateCardsInput {
  @ApiProperty()
  @IsDateOnly()
  effectiveFrom!: string;

  @ApiProperty({ type: [GradeRateDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => GradeRateDto)
  rates!: GradeRateDto[];
}

export class PutEmployeeRateDto implements PutEmployeeRateInput {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty()
  @IsDateOnly()
  effectiveFrom!: string;

  @ApiProperty()
  @IsRate()
  costRatePerHour!: string;

  @ApiProperty()
  @IsRate()
  chargeOutRatePerHour!: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class PutWorkingCalendarDto implements PutWorkingCalendarInput {
  @ApiProperty({ example: [1, 2, 3, 4, 5, 6], description: 'ISO weekdays, 1 = Monday.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  workingWeekdays!: number[];

  @ApiProperty({ example: '8' })
  @Matches(/^\d{1,2}(\.\d{1,2})?$/, { message: 'workingHoursPerDay must be hours, like 8 or 7.5' })
  workingHoursPerDay!: string;
}
