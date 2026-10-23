import { Body, Controller, Get, HttpCode, Post, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type ClientMasterPreview, type ClientMasterResult } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { ClientMasterDto } from './dto/client-master.dto';
import { ClientMasterService } from './client-master.service';

const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The Client Master workbook: export the clients with their gaps, fill them, import it back. */
@ApiTags('client-imports')
@Controller('client-imports/master')
export class ClientMasterController {
  constructor(private readonly master: ClientMasterService) {}

  @Get('export')
  @RequirePermissions(PERMISSION.entityManage)
  @ApiOperation({
    summary: 'Every client you can see in the Client Master workbook (logins masked, no passwords)',
  })
  async export(@CurrentPrincipal() principal: Principal): Promise<StreamableFile> {
    const f = await this.master.export(rlsContextFromPrincipal(principal));
    return new StreamableFile(f.data, {
      type: xlsx,
      disposition: `attachment; filename="${f.filename}"`,
    });
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.entityManage, PERMISSION.credentialManage)
  @ApiOperation({ summary: 'What importing the workbook would do, row by row' })
  preview(
    @CurrentPrincipal() principal: Principal,
    @Body() body: ClientMasterDto,
  ): Promise<ClientMasterPreview> {
    return this.master.preview(rlsContextFromPrincipal(principal), body);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions(PERMISSION.entityManage, PERMISSION.credentialManage)
  @ApiOperation({
    summary:
      'Create or fill in the clients, add registrations, contacts and addresses, save logins and open their Compliance engagements — one client at a time',
  })
  import(
    @CurrentPrincipal() principal: Principal,
    @Body() body: ClientMasterDto,
  ): Promise<ClientMasterResult> {
    return this.master.import(rlsContextFromPrincipal(principal), body);
  }
}
