import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type DocumentTemplateRecord } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { DocumentTemplatesService, type FirmSettings } from './document-templates.service';
import {
  CreateTemplateVariantDto,
  UpdateFirmSettingsDto,
  UpdateTemplateVariantDto,
  UploadTemplateVersionDto,
} from './dto/document-template.dto';

/**
 * Firm document templates (Section 01 spec §2, §10.2) and the firm details they
 * merge in. Read by every user; uploaded, approved and configured by MP/admin
 * (`service.manage` + RLS `ctx_is_firmwide`). Versions are append-only.
 */
@ApiTags('document-templates')
@Controller()
export class DocumentTemplatesController {
  constructor(private readonly templates: DocumentTemplatesService) {}

  @Get('document-templates')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'List the firm templates with their variants and versions' })
  list(@CurrentPrincipal() principal: Principal): Promise<DocumentTemplateRecord[]> {
    return this.templates.list(rlsContextFromPrincipal(principal));
  }

  @Post('document-templates')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Add a template variant (e.g. a listed-company engagement letter)' })
  createVariant(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateTemplateVariantDto,
  ): Promise<DocumentTemplateRecord> {
    return this.templates.createVariant(rlsContextFromPrincipal(principal), dto);
  }

  @Patch('document-templates/:templateId')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Rename a variant, change when it applies, or switch it off' })
  updateVariant(
    @CurrentPrincipal() principal: Principal,
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Body() dto: UpdateTemplateVariantDto,
  ): Promise<DocumentTemplateRecord> {
    return this.templates.updateVariant(rlsContextFromPrincipal(principal), templateId, dto);
  }

  @Post('document-templates/:templateId/versions')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Upload a new .docx version (draft; merge fields are scanned)' })
  upload(
    @CurrentPrincipal() principal: Principal,
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Body() dto: UploadTemplateVersionDto,
  ): Promise<DocumentTemplateRecord> {
    return this.templates.uploadVersion(rlsContextFromPrincipal(principal), templateId, dto);
  }

  @Post('document-templates/:templateId/versions/:versionId/approve')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Approve a version — it becomes the one Create from Template uses' })
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
  ): Promise<DocumentTemplateRecord> {
    return this.templates.approveVersion(rlsContextFromPrincipal(principal), templateId, versionId);
  }

  @Get('document-templates/:templateId/versions/:versionId/download')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Download a template version' })
  async download(
    @CurrentPrincipal() principal: Principal,
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
  ): Promise<StreamableFile> {
    const file = await this.templates.downloadVersion(
      rlsContextFromPrincipal(principal),
      templateId,
      versionId,
    );
    return new StreamableFile(file.buffer, {
      type: file.contentType,
      disposition: `attachment; filename="${file.filename.replace(/["\r\n]/g, '_')}"`,
      length: file.buffer.length,
    });
  }

  @Get('firm-settings')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "The firm's own details used in templates" })
  firm(@CurrentPrincipal() principal: Principal): Promise<FirmSettings> {
    return this.templates.getFirm(rlsContextFromPrincipal(principal));
  }

  @Patch('firm-settings')
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: "Update the firm's name, FRN, address and email" })
  updateFirm(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: UpdateFirmSettingsDto,
  ): Promise<FirmSettings> {
    return this.templates.updateFirm(rlsContextFromPrincipal(principal), dto);
  }
}
