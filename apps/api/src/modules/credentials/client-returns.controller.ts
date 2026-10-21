import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type ClientReturns } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { ClientReturnsQueryDto } from './dto/client-returns.dto';
import { ClientReturnsService } from './client-returns.service';

/** ADR-0035 — the GST returns the firm's sheet marks filed / NA, client by client. */
@ApiTags('client-returns')
@Controller('client-returns')
export class ClientReturnsController {
  constructor(private readonly returns: ClientReturnsService) {}

  @Get()
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({
    summary:
      "The clients' GST return history from the imported workbook: GSTR-1 / 3B / 7 filed or NA, by month or quarter",
  })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ClientReturnsQueryDto,
  ): Promise<ClientReturns> {
    return this.returns.list(rlsContextFromPrincipal(principal), query.entityId);
  }
}
