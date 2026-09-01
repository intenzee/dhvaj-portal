import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { paginate } from '../../common/pagination/pagination.dto';
import { DocumentsService } from './documents.service';
import { OnlyOfficeService, type EditorSession } from './onlyoffice/onlyoffice.service';
import type { DocumentDetail, DocumentRecord } from './documents.types';
import {
  AddVersionDto,
  ArchiveDocumentDto,
  CreateDocumentDto,
  DocumentListQueryDto,
  UpdateDocumentDto,
} from './dto/document.dto';

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
    } = {};
    if (query.status) filter.status = query.status;
    if (query.documentType) filter.documentType = query.documentType;
    if (query.classification) filter.classification = query.classification;
    if (query.search) filter.search = query.search;
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
