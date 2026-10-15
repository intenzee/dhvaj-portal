import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type ClientImportPreview, type ClientImportResult } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { ClientImportDto } from './dto/client-import.dto';
import { ClientImportService } from './client-import.service';

/** ADR-0035 — import clients, GSTINs, TANs, logins and filing marks from the firm's login workbook. */
@ApiTags('client-imports')
@Controller('client-imports/workbook')
export class ClientImportController {
  constructor(private readonly imports: ClientImportService) {}

  @Post('preview')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.entityManage, PERMISSION.credentialManage)
  @ApiOperation({
    summary: 'What the import would do, client by client (logins shown only masked)',
  })
  preview(
    @CurrentPrincipal() principal: Principal,
    @Body() body: ClientImportDto,
  ): Promise<ClientImportPreview> {
    return this.imports.preview(rlsContextFromPrincipal(principal), body);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions(PERMISSION.entityManage, PERMISSION.credentialManage)
  @ApiOperation({
    summary:
      'Create or update the clients, save the logins (encrypted), set GST frequency and apply filed / NA marks — one client at a time',
  })
  import(
    @CurrentPrincipal() principal: Principal,
    @Body() body: ClientImportDto,
  ): Promise<ClientImportResult> {
    return this.imports.import(rlsContextFromPrincipal(principal), body);
  }
}
