import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';
import { FINANCIAL_SOURCES, FINANCIAL_YEAR_REGEX, type FinancialSource } from '@hsdg/contracts';

/**
 * Year-wise financial figures (§16/§17). Recording a year that already has a
 * current figure set supersedes it (append-only) — it is never overwritten.
 * All amounts optional (progressive completion); profit/net-worth may be
 * negative, so no Min on those.
 */
export class AddFinancialProfileDto {
  @ApiProperty({ example: '2024-25' })
  @Matches(FINANCIAL_YEAR_REGEX, { message: 'financialYear must be like "2024-25"' })
  financialYear!: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) turnover?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) revenue?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) otherIncome?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() netProfit?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() profitBeforeTax?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() netWorth?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  paidUpCapital?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() reservesSurplus?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) totalAssets?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalBorrowings?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  bankPfiBorrowings?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  publicDeposits?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) debentures?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  outstandingLoans?: number;

  @ApiPropertyOptional({ enum: FINANCIAL_SOURCES, default: 'other' })
  @IsOptional()
  @IsIn(FINANCIAL_SOURCES)
  source?: FinancialSource;

  @ApiPropertyOptional({ example: '2024-25' })
  @IsOptional()
  @Matches(FINANCIAL_YEAR_REGEX, { message: 'sourceFinancialYear must be like "2024-25"' })
  sourceFinancialYear?: string;

  @ApiPropertyOptional({ description: 'Soft link to supporting evidence.' })
  @IsOptional()
  @IsString()
  supportingDocumentRef?: string;
}
