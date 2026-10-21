import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type {
  ApprovalListQuery,
  BillingClientListQuery,
  RequestInvoiceIssueInput,
} from '@hsdg/contracts';

/** GET /billing/clients */
export class BillingClientListQueryDto implements Omit<BillingClientListQuery, 'owing'> {
  @ApiPropertyOptional({ description: 'Name, code or GSTIN contains' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  owing?: 'true' | 'false';

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/** POST /billing/invoices/:id/request-issue */
export class RequestInvoiceIssueDto implements RequestInvoiceIssueInput {
  @ApiPropertyOptional({ description: 'What the partner should know' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** GET /billing/approvals */
export class ApprovalListQueryDto implements ApprovalListQuery {
  @ApiPropertyOptional({ enum: ['mine', 'all'], default: 'mine' })
  @IsOptional()
  @IsIn(['mine', 'all'])
  scope?: 'mine' | 'all';

  @ApiPropertyOptional({ enum: ['pending', 'recent'], default: 'pending' })
  @IsOptional()
  @IsIn(['pending', 'recent'])
  status?: 'pending' | 'recent';
}
