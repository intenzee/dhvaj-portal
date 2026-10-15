import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type GstImportPreview, type GstImportResult } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { GstImportDto } from './dto/gst-import.dto';
import { GstImportService } from './gst-import.service';

/** ADR-0035 — import GST clients, their GSTINs and portal logins from a spreadsheet. */
@ApiTags('client-imports')
@Controller('client-imports/gst')
export class GstImportController {
  constructor(private readonly imports: GstImportService) {}

  @Post('preview')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.entityManage, PERMISSION.credentialManage)
  @ApiOperation({
    summary: 'What the import would do, row by row (logins shown only as present / masked)',
  })
  preview(
    @CurrentPrincipal() principal: Principal,
    @Body() body: GstImportDto,
  ): Promise<GstImportPreview> {
    return this.imports.preview(rlsContextFromPrincipal(principal), body);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions(PERMISSION.entityManage, PERMISSION.credentialManage)
  @ApiOperation({
    summary: 'Create the clients and GSTINs and save the logins (encrypted), one client at a time',
  })
  import(
    @CurrentPrincipal() principal: Principal,
    @Body() body: GstImportDto,
  ): Promise<GstImportResult> {
    return this.imports.import(rlsContextFromPrincipal(principal), body);
  }
}
