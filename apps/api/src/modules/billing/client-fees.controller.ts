import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type ClientFees } from '@hsdg/contracts';
import { CurrentPrincipal, RequireAnyPermission } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { ClientFeesService } from './client-fees.service';

/** CM-4 · the Fees card on Client 360. */
@ApiTags('billing')
@Controller('entities')
export class ClientFeesController {
  constructor(private readonly fees: ClientFeesService) {}

  @Get(':id/fees')
  @RequireAnyPermission(PERMISSION.engagementReadCommercial, PERMISSION.feeAgree)
  @ApiOperation({
    summary: "A client's open engagements with their fee, its period and the year value",
  })
  forClient(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClientFees> {
    return this.fees.forClient(
      rlsContextFromPrincipal(principal),
      id,
      principal.permissions.includes(PERMISSION.feeAgree),
    );
  }
}
