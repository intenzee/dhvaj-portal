import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type HrDocument } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { HrDocumentsService } from './hr-documents.service';
import { HrDocumentListQueryDto, UploadHrDocumentDto } from './dto/hr-document.dto';

/**
 * The HR documents vault (spec §4.7). `employee.manage` gets a caller this far;
 * the database then lets only HR and the Managing Partner see or add a file,
 * so the administrator gets an empty vault and a refusal.
 */
@ApiTags('people')
@Controller('people/employees/:id/documents')
export class HrDocumentsController {
  constructor(private readonly vault: HrDocumentsService) {}

  @Get()
  @RequirePermissions(PERMISSION.employeeManage)
  @ApiOperation({ summary: 'A person’s HR documents (HR and the Managing Partner only)' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: HrDocumentListQueryDto,
  ): Promise<HrDocument[]> {
    return this.vault.list(rlsContextFromPrincipal(principal), id, q.archived ?? false);
  }

  @Post()
  @RequirePermissions(PERMISSION.employeeManage)
  @ApiOperation({ summary: 'Add a file to the vault (audited)' })
  upload(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UploadHrDocumentDto,
  ): Promise<HrDocument> {
    return this.vault.upload(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post(':docId/archive')
  @RequirePermissions(PERMISSION.employeeManage)
  @ApiOperation({ summary: 'Archive a file uploaded by mistake (audited; never deleted)' })
  archive(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
  ): Promise<HrDocument> {
    return this.vault.setArchived(rlsContextFromPrincipal(principal), id, docId, true);
  }

  @Post(':docId/restore')
  @RequirePermissions(PERMISSION.employeeManage)
  @ApiOperation({ summary: 'Bring an archived file back (audited)' })
  restore(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
  ): Promise<HrDocument> {
    return this.vault.setArchived(rlsContextFromPrincipal(principal), id, docId, false);
  }

  @Get(':docId/download')
  @RequirePermissions(PERMISSION.employeeManage)
  @ApiOperation({ summary: 'Download a file (audited; streamed through the API)' })
  async download(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
  ): Promise<StreamableFile> {
    const file = await this.vault.download(rlsContextFromPrincipal(principal), id, docId);
    const safeName = file.filename.replace(/["\r\n]/g, '_');
    return new StreamableFile(file.buffer, {
      type: file.contentType,
      disposition: `attachment; filename="${safeName}"`,
      length: file.sizeBytes,
    });
  }
}
