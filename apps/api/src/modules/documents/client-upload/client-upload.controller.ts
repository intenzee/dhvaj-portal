import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@hsdg/contracts';
import { CurrentPrincipal, Public, RequirePermissions } from '../../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../../auth/principal';
import {
  ClientUploadService,
  type ClientUploadLinkCreated,
  type ClientUploadLinkInfo,
  type ClientUploadLinkRecord,
} from './client-upload.service';
import { ClientUploadDto, CreateUploadLinkDto } from './client-upload.dto';

/**
 * Staff management of client upload links (engagement leads). Minting a link
 * returns the raw token ONCE — the caller shows/sends it and it is never
 * retrievable again.
 */
@ApiTags('client-upload-links')
@Controller('engagements')
export class ClientUploadLinksController {
  constructor(private readonly service: ClientUploadService) {}

  @Post(':id/client-dependencies/:depId/upload-links')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Mint a secure magic upload link for a client dependency (token shown once).',
  })
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('depId', new ParseUUIDPipe()) depId: string,
    @Body() dto: CreateUploadLinkDto,
  ): Promise<ClientUploadLinkCreated> {
    return this.service.createLink(rlsContextFromPrincipal(principal), id, depId, dto);
  }

  @Get(':id/client-dependencies/:depId/upload-links')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'List upload links for a client dependency (no tokens).' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('depId', new ParseUUIDPipe()) depId: string,
  ): Promise<ClientUploadLinkRecord[]> {
    return this.service.listLinks(rlsContextFromPrincipal(principal), id, depId);
  }

  @Post(':id/client-dependencies/:depId/upload-links/:linkId/revoke')
  @HttpCode(204)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Revoke an upload link.' })
  async revoke(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('linkId', new ParseUUIDPipe()) linkId: string,
  ): Promise<void> {
    await this.service.revokeLink(rlsContextFromPrincipal(principal), id, linkId);
  }
}

/**
 * PUBLIC client upload endpoints — no authentication; the opaque token is the
 * authorisation and is validated server-side against its stored hash. Inert
 * (404) unless CLIENT_UPLOAD_ENABLED. Nothing here can browse or read documents;
 * it can only submit a file against the token's dependency.
 */
@ApiTags('client-upload-public')
@Controller('client-upload')
export class ClientUploadPublicController {
  constructor(private readonly service: ClientUploadService) {}

  @Get(':token')
  @Public()
  @ApiOperation({ summary: 'Public: what this upload link is requesting (or invalid/expired).' })
  info(@Param('token') token: string): Promise<ClientUploadLinkInfo> {
    return this.service.publicInfo(token);
  }

  @Post(':token')
  @Public()
  @ApiOperation({ summary: 'Public: upload a file against this link.' })
  upload(@Param('token') token: string, @Body() dto: ClientUploadDto): Promise<{ ok: true }> {
    return this.service.publicUpload(token, dto);
  }
}
