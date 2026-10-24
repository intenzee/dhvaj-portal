import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CLIENT_MASTER_PASSWORDS_MASKED_HEADER,
  CLIENT_MASTER_PASSWORDS_SHOWN_HEADER,
  PERMISSION,
  type ClientMasterPreview,
  type ClientMasterResult,
} from '@hsdg/contracts';
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
    summary:
      'Every client you can see in the Client Master workbook, its main logins on its row — masked, or with passwords=true written in full where you may reveal them (each one logged)',
  })
  @ApiQuery({ name: 'passwords', required: false, type: Boolean })
  async export(
    @CurrentPrincipal() principal: Principal,
    @Query('passwords') passwords: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const withPasswords = passwords === 'true' || passwords === '1';
    if (withPasswords && !principal.permissions.includes(PERMISSION.credentialReveal))
      throw new ForbiddenException('Seeing client passwords needs the credential.reveal right.');
    const f = await this.master.export(rlsContextFromPrincipal(principal), {
      passwords: withPasswords,
    });
    res.setHeader(CLIENT_MASTER_PASSWORDS_SHOWN_HEADER, String(f.passwordsShown));
    res.setHeader(CLIENT_MASTER_PASSWORDS_MASKED_HEADER, String(f.passwordsMasked));
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
