import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FEATURE_FLAG, type ReceivablesReport } from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { CurrentPrincipal } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { requireBillingReader } from './billing.controller';
import { ReceivablesService } from './receivables.service';

/**
 * PS-203 · the receivables report: per client and per engagement partner, the
 * balance by age band, the oldest invoice and the last receipt. billing.manage
 * or report.read; RLS keeps a partner or manager to their office's clients.
 */
@ApiTags('billing')
@Controller('reports')
export class ReceivablesController {
  constructor(
    private readonly receivables: ReceivablesService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get('receivables')
  @ApiOperation({ summary: 'Receivables by age band, per client and per engagement partner' })
  report(@CurrentPrincipal() principal: Principal): Promise<ReceivablesReport> {
    if (!this.flags.isOnFor(FEATURE_FLAG.billing, principal.officeCode)) {
      throw new NotFoundException();
    }
    requireBillingReader(principal);
    return this.receivables.report(rlsContextFromPrincipal(principal));
  }
}
