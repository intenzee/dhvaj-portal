import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, ROLE, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { DocumentsService } from './documents.service';
import { OnlyOfficeService, type EditorSession } from './onlyoffice/onlyoffice.service';
import { M365Service, type M365EditorSession } from './m365/m365.service';
import type { DocumentDetail, DocumentRecord } from './documents.types';
import {
  AddVersionDto,
  ArchiveDocumentDto,
  CreateDocumentDto,
  DeleteDocumentDto,
  DocumentListQueryDto,
  UpdateDocumentDto,
} from './dto/document.dto';

/**
 * Roles permitted to delete/restore a document. Only the managing partner — the
 * one business-firm-wide authority (platform `admin` is intentionally excluded
 * from engagement data, so it could not see documents anyway).
 */
const DOCUMENT_DELETE_ROLES: readonly string[] = [ROLE.managingPartner];

/** True when the principal may soft-delete / restore documents (managing partner). */
function canDeleteDocuments(principal: Principal): boolean {
  const held = [principal.effectiveRole, ...principal.roles].filter(Boolean) as string[];
  return held.some((r) => DOCUMENT_DELETE_ROLES.includes(r));
}

/**
 * Engagement documents (Phase 10). Reads/downloads need `engagement.read`
 * (members); upload/re-version/re-classify/archive/restore need
 * `engagement.manage` (leads). Access inherits the engagement, enforced by RLS;
 * downloads are audited and stream through the API, never a direct storage URL.
 */
@ApiTags('engagement-documents')
@Controller('engagements')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly onlyoffice: OnlyOfficeService,
    private readonly m365: M365Service,
  ) {}

  @Post(':id/documents/:docId/onlyoffice/session')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Build an embedded OnlyOffice editor session for a document' })
  onlyofficeSession(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
  ): Promise<EditorSession> {
    return this.onlyoffice.buildSession(principal, id, docId);
  }

  @Post(':id/documents/:docId/m365/session')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Build an embedded Microsoft 365 (SharePoint Online) editor session' })
  m365Session(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
  ): Promise<M365EditorSession> {
    return this.m365.buildSession(principal, id, docId);
  }

  @Post(':id/documents/:docId/m365/commit')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Commit the live Microsoft 365 copy as a new audited version' })
  m365Commit(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
  ): Promise<DocumentDetail> {
    return this.m365.commit(principal, id, docId);
  }

  @Get(':id/documents')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'List documents (paginated); filter ?status=&documentType=&classification=&search=',
  })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: DocumentListQueryDto,
  ): Promise<Paginated<DocumentRecord>> {
    const filter: {
      status?: DocumentListQueryDto['status'];
      documentType?: DocumentListQueryDto['documentType'];
      classification?: DocumentListQueryDto['classification'];
      search?: string;
      taskId?: string;
      componentInstanceId?: string;
      deleted?: boolean;
    } = {};
    if (query.status) filter.status = query.status;
    if (query.documentType) filter.documentType = query.documentType;
    if (query.classification) filter.classification = query.classification;
    if (query.search) filter.search = query.search;
    if (query.taskId) filter.taskId = query.taskId;
    if (query.componentInstanceId) filter.componentInstanceId = query.componentInstanceId;
    // The deleted view is a managing-partner-only tool for restoring; ignore the
    // flag for everyone else so soft-deleted docs stay hidden.
    if (query.deleted && canDeleteDocuments(principal)) filter.deleted = true;
    return this.documents
      .list(rlsContextFromPrincipal(principal), id, query, filter)
      .then((result) => paginate(result, query));
  }

  @Get(':id/documents/:docId')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Get a document with its full version history' })
  getOne(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
  ): Promise<DocumentDetail> {
    return this.documents.getOne(rlsContextFromPrincipal(principal), id, docId);
  }

  @Post(':id/documents')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Upload a document (first version); bytes base64-encoded (audited)' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateDocumentDto,
  ): Promise<DocumentRecord> {
    return this.documents.create(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post(':id/documents/:docId/versions')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Upload a new version (supersedes; earlier versions retained, audited)',
  })
  addVersion(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Body() dto: AddVersionDto,
  ): Promise<DocumentDetail> {
    return this.documents.addVersion(rlsContextFromPrincipal(principal), id, docId, dto);
  }

  @Patch(':id/documents/:docId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update document metadata (audited; optimistic concurrency)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Body() dto: UpdateDocumentDto,
  ): Promise<DocumentRecord> {
    return this.documents.update(rlsContextFromPrincipal(principal), id, docId, dto);
  }

  @Post(':id/documents/:docId/archive')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Archive a document (reason recorded; audited)' })
  archive(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Body() dto: ArchiveDocumentDto,
  ): Promise<DocumentRecord> {
    return this.documents.archive(rlsContextFromPrincipal(principal), id, docId, dto);
  }

  @Post(':id/documents/:docId/restore')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Restore an archived document (reason recorded; audited)' })
  restore(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Body() dto: ArchiveDocumentDto,
  ): Promise<DocumentRecord> {
    return this.documents.restore(rlsContextFromPrincipal(principal), id, docId, dto);
  }

  @Post(':id/documents/:docId/delete')
  @HttpCode(204)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary:
      'Soft-delete a document — hidden everywhere, retained for audit, restorable (managing partner only; audited)',
  })
  async delete(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Body() dto: DeleteDocumentDto,
  ): Promise<void> {
    if (!canDeleteDocuments(principal)) {
      throw new ForbiddenException('Only the managing partner may delete a document.');
    }
    await this.documents.softDelete(rlsContextFromPrincipal(principal), id, docId, dto.reason);
  }

  @Post(':id/documents/:docId/undelete')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Restore a soft-deleted document (managing partner only; audited)' })
  undelete(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Body() dto: DeleteDocumentDto,
  ): Promise<DocumentRecord> {
    if (!canDeleteDocuments(principal)) {
      throw new ForbiddenException('Only the managing partner may restore a document.');
    }
    return this.documents.restoreDeleted(rlsContextFromPrincipal(principal), id, docId, dto.reason);
  }

  @Post(':id/documents/:docId/extract')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Re-run text extraction (Azure Document Intelligence) for a document; returns detail',
  })
  async extract(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
  ): Promise<DocumentDetail> {
    const ctx = rlsContextFromPrincipal(principal);
    await this.documents.reextract(ctx, id, docId);
    return this.documents.getOne(ctx, id, docId);
  }

  @Get(':id/documents/:docId/download')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Download the current version bytes (audited; RLS-mediated)' })
  async download(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
  ): Promise<StreamableFile> {
    const file = await this.documents.download(rlsContextFromPrincipal(principal), id, docId);
    return toStreamableFile(file);
  }

  @Get(':id/documents/:docId/versions/:versionId/download')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Download a specific version’s bytes (audited; RLS-mediated)' })
  async downloadVersion(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
  ): Promise<StreamableFile> {
    const file = await this.documents.download(
      rlsContextFromPrincipal(principal),
      id,
      docId,
      versionId,
    );
    return toStreamableFile(file);
  }
}

function toStreamableFile(file: {
  buffer: Buffer;
  filename: string;
  contentType: string;
  sizeBytes: number;
}): StreamableFile {
  // Sanitise the filename for the Content-Disposition header (strip quotes/CR/LF).
  const safeName = file.filename.replace(/["\r\n]/g, '_');
  return new StreamableFile(file.buffer, {
    type: file.contentType,
    disposition: `attachment; filename="${safeName}"`,
    length: file.sizeBytes,
  });
}
