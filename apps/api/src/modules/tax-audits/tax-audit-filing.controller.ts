import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type TaxAuditFiling } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import {
  FileTaxAuditReportDto,
  RecordTaxAuditAcceptanceDto,
  RecordTaxAuditRejectionDto,
  RecordTaxAuditUploadDto,
  SignTaxAuditReportDto,
  TaxAuditReasonDto,
} from './dto/tax-audit-filing.dto';
import { TaxAuditFilingService } from './tax-audit-filing.service';

const FILING = 'engagements/:id/tax-audits/:auditId/filing';

/**
 * Tax Audit sign and file (Phase 5, F-8). Membership of the engagement is the
 * gate (RLS); the service decides who signs (the signing Partner) and who
 * records the upload, the client's answer and the filing.
 */
@ApiTags('tax-audits')
@Controller()
export class TaxAuditFilingController {
  constructor(private readonly filing: TaxAuditFilingService) {}

  @Get(FILING)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The report: signature, upload, the client’s answer, the filing, revisions',
  })
  get(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
  ): Promise<TaxAuditFiling> {
    return this.filing.get(rlsContextFromPrincipal(p), id, auditId);
  }

  @Post(`${FILING}/sign`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'The signing Partner signs: UDIN and the signed report' })
  sign(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: SignTaxAuditReportDto,
  ): Promise<TaxAuditFiling> {
    return this.filing.sign(rlsContextFromPrincipal(p), id, auditId, body);
  }

  @Post(`${FILING}/withdraw`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Withdraw the signature before upload; back to review' })
  withdraw(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: TaxAuditReasonDto,
  ): Promise<TaxAuditFiling> {
    return this.filing.withdraw(rlsContextFromPrincipal(p), id, auditId, body);
  }

  @Post(`${FILING}/uploaded`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Record the upload on the e-filing portal' })
  uploaded(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: RecordTaxAuditUploadDto,
  ): Promise<TaxAuditFiling> {
    return this.filing.uploaded(rlsContextFromPrincipal(p), id, auditId, body);
  }

  @Post(`${FILING}/client-accepted`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Record the client’s acceptance' })
  clientAccepted(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: RecordTaxAuditAcceptanceDto,
  ): Promise<TaxAuditFiling> {
    return this.filing.clientAccepted(rlsContextFromPrincipal(p), id, auditId, body);
  }

  @Post(`${FILING}/client-rejected`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Record the client’s rejection; the report goes back to review' })
  clientRejected(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: RecordTaxAuditRejectionDto,
  ): Promise<TaxAuditFiling> {
    return this.filing.clientRejected(rlsContextFromPrincipal(p), id, auditId, body);
  }

  @Post(`${FILING}/filed`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Filed, with the acknowledgement (lodges the year’s filing)' })
  file(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: FileTaxAuditReportDto,
  ): Promise<TaxAuditFiling> {
    return this.filing.file(rlsContextFromPrincipal(p), id, auditId, body);
  }

  @Post(`${FILING}/revise`)
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Revise a filed report: the next revision, with its reason' })
  revise(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() body: TaxAuditReasonDto,
  ): Promise<TaxAuditFiling> {
    return this.filing.revise(rlsContextFromPrincipal(p), id, auditId, body);
  }
}
