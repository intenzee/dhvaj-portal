import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type Certificate,
  type CertificateRegisterRow,
  type CertificateTemplate,
} from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { CertificatesService } from './certificates.service';
import {
  CertificateRegisterQueryDto,
  CertificateVersionDto,
  CreateCertificateDto,
  RecordForm15caDto,
  ReviewCertificateDto,
  RevokeCertificateDto,
  SignCertificateDto,
  UpdateCertificateDto,
} from './dto/certificates.dto';

/**
 * Practice Services PS-402 — the certificates desk, behind ff_certificates
 * (404 when off for the caller's office). Reads need engagement.read and RLS
 * decides which engagements; the engagement's team writes (RLS), and the
 * service checks who reviews, signs, issues and revokes.
 */
@ApiTags('certificates')
@Controller()
@RequirePermissions(PERMISSION.engagementRead)
export class CertificatesController {
  constructor(
    private readonly certificates: CertificatesService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get('certificates/templates')
  @ApiOperation({ summary: 'The certificate templates in force (or on asOn)' })
  templates(
    @CurrentPrincipal() p: Principal,
    @Query('asOn') asOn?: string,
  ): Promise<CertificateTemplate[]> {
    this.gate(p);
    const day = asOn && /^\d{4}-\d{2}-\d{2}$/.test(asOn) ? asOn : undefined;
    return this.certificates.templates(rlsContextFromPrincipal(p), day);
  }

  @Get('registers/certificates')
  @ApiOperation({ summary: 'The certificate register: every certificate the caller can see' })
  register(
    @CurrentPrincipal() p: Principal,
    @Query() q: CertificateRegisterQueryDto,
  ): Promise<CertificateRegisterRow[]> {
    this.gate(p);
    return this.certificates.register(rlsContextFromPrincipal(p), q);
  }

  @Get('engagements/:id/certificates')
  @ApiOperation({ summary: "An engagement's certificates" })
  list(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Certificate[]> {
    this.gate(p);
    return this.certificates.list(rlsContextFromPrincipal(p), id);
  }

  @Post('engagements/:id/certificates')
  @ApiOperation({ summary: 'Start a certificate from a template' })
  create(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateCertificateDto,
  ): Promise<Certificate> {
    this.gate(p);
    return this.certificates.create(rlsContextFromPrincipal(p), id, body);
  }

  @Get('engagements/:id/certificates/:certId')
  get(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('certId', new ParseUUIDPipe()) certId: string,
  ): Promise<Certificate> {
    this.gate(p);
    return this.certificates.get(rlsContextFromPrincipal(p), id, certId);
  }

  @Patch('engagements/:id/certificates/:certId')
  @ApiOperation({ summary: "Change a draft's purpose, addressee or figures" })
  update(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('certId', new ParseUUIDPipe()) certId: string,
    @Body() body: UpdateCertificateDto,
  ): Promise<Certificate> {
    this.gate(p);
    return this.certificates.update(rlsContextFromPrincipal(p), id, certId, body);
  }

  @Post('engagements/:id/certificates/:certId/submit')
  @HttpCode(200)
  submit(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('certId', new ParseUUIDPipe()) certId: string,
    @Body() body: CertificateVersionDto,
  ): Promise<Certificate> {
    this.gate(p);
    return this.certificates.submit(rlsContextFromPrincipal(p), id, certId, body.version);
  }

  @Post('engagements/:id/certificates/:certId/review')
  @HttpCode(200)
  review(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('certId', new ParseUUIDPipe()) certId: string,
    @Body() body: ReviewCertificateDto,
  ): Promise<Certificate> {
    this.gate(p);
    return this.certificates.review(rlsContextFromPrincipal(p), id, certId, body);
  }

  @Post('engagements/:id/certificates/:certId/sign')
  @HttpCode(200)
  sign(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('certId', new ParseUUIDPipe()) certId: string,
    @Body() body: SignCertificateDto,
  ): Promise<Certificate> {
    this.gate(p);
    return this.certificates.sign(rlsContextFromPrincipal(p), id, certId, body);
  }

  @Post('engagements/:id/certificates/:certId/issue')
  @HttpCode(200)
  issue(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('certId', new ParseUUIDPipe()) certId: string,
    @Body() body: CertificateVersionDto,
  ): Promise<Certificate> {
    this.gate(p);
    return this.certificates.issue(rlsContextFromPrincipal(p), id, certId, body.version);
  }

  @Post('engagements/:id/certificates/:certId/revoke')
  @HttpCode(200)
  revoke(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('certId', new ParseUUIDPipe()) certId: string,
    @Body() body: RevokeCertificateDto,
  ): Promise<Certificate> {
    this.gate(p);
    return this.certificates.revoke(rlsContextFromPrincipal(p), id, certId, body);
  }

  @Post('engagements/:id/certificates/:certId/form-15ca')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record the Form 145 / 15CA acknowledgement' })
  recordForm15ca(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('certId', new ParseUUIDPipe()) certId: string,
    @Body() body: RecordForm15caDto,
  ): Promise<Certificate> {
    this.gate(p);
    return this.certificates.recordForm15ca(rlsContextFromPrincipal(p), id, certId, body);
  }

  @Get('engagements/:id/certificates/:certId/pdf')
  @ApiOperation({ summary: 'The certificate as a PDF (a draft prints as a draft)' })
  async pdf(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('certId', new ParseUUIDPipe()) certId: string,
  ): Promise<StreamableFile> {
    this.gate(p);
    const { name, pdf } = await this.certificates.pdf(rlsContextFromPrincipal(p), id, certId);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="${name}"`,
    });
  }

  private gate(p: Principal): void {
    if (!this.flags.isOnFor(FEATURE_FLAG.certificates, p.officeCode)) throw new NotFoundException();
  }
}
