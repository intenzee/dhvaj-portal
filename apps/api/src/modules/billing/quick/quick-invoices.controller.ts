import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type FirmInvoiceProfile,
  type InvoiceSendOptions,
  type InvoiceSendRecord,
  type InvoiceService,
  type InvoiceShareInfo,
  type QuickInvoiceResult,
  type RecurringInvoiceSchedule,
  type SendInvoiceResult,
} from '@hsdg/contracts';
import {
  CurrentPrincipal,
  Public,
  RequireAnyPermission,
  RequirePermissions,
} from '../../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../../auth/principal';
import { FeatureFlagsService } from '../../../common/feature-flags/feature-flags.service';
import { FirmProfileService } from './firm-profile.service';
import { QuickInvoicesService } from './quick-invoices.service';
import { RecurringInvoicesService } from './recurring-invoices.service';
import {
  QuickInvoiceDto,
  SendInvoiceDto,
  SetFirmLogoDto,
  SetRecurringInvoiceDto,
  UpdateFirmProfileDto,
} from './quick-invoices.dto';

/**
 * Quick invoices on the engagement: the services to bill, a one-row invoice,
 * sending it, and a monthly schedule per service. Same permission floor as
 * the invoice endpoints (engagement.manage or billing.manage to write).
 */
@ApiTags('quick-invoices')
@Controller('engagements')
export class QuickInvoicesController {
  constructor(
    private readonly quick: QuickInvoicesService,
    private readonly recurring: RecurringInvoicesService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get(':id/invoice-services')
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.engagementReadCommercial)
  @ApiOperation({ summary: 'The engagement’s services to bill, each with its monthly schedule' })
  services(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<InvoiceService[]> {
    return this.quick.services(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/invoices/quick')
  @RequireAnyPermission(PERMISSION.engagementManage, PERMISSION.billingManage)
  @ApiOperation({ summary: 'One-row invoice: service, amount, GST % — issued when allowed' })
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: QuickInvoiceDto,
  ): Promise<QuickInvoiceResult> {
    return this.quick.quick(rlsContextFromPrincipal(principal), id, dto, {
      permissions: principal.permissions,
      reasonRequired: this.flags.isOnFor(FEATURE_FLAG.billing, principal.officeCode),
    });
  }

  @Put(':id/invoice-services/:serviceId/schedule')
  @RequireAnyPermission(PERMISSION.engagementManage, PERMISSION.billingManage)
  @ApiOperation({ summary: 'Set, pause or resume a service’s monthly invoice (audited)' })
  setSchedule(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @Body() dto: SetRecurringInvoiceDto,
  ): Promise<RecurringInvoiceSchedule> {
    return this.recurring.set(rlsContextFromPrincipal(principal), id, serviceId, dto);
  }

  @Delete(':id/invoice-services/:serviceId/schedule')
  @HttpCode(204)
  @RequireAnyPermission(PERMISSION.engagementManage, PERMISSION.billingManage)
  @ApiOperation({ summary: 'Stop a service’s monthly invoice (audited)' })
  async removeSchedule(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
  ): Promise<void> {
    await this.recurring.remove(rlsContextFromPrincipal(principal), id, serviceId);
  }

  @Get(':id/invoices/:invoiceId/send-options')
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.engagementReadCommercial)
  @ApiOperation({ summary: 'How the client can be sent this invoice (e-mail, WhatsApp)' })
  sendOptions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ): Promise<InvoiceSendOptions> {
    return this.quick.sendOptions(rlsContextFromPrincipal(principal), id, invoiceId);
  }

  @Post(':id/invoices/:invoiceId/send')
  @RequireAnyPermission(PERMISSION.engagementManage, PERMISSION.billingManage)
  @ApiOperation({ summary: 'Send an issued invoice to the client (logged, audited)' })
  send(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body() dto: SendInvoiceDto,
  ): Promise<SendInvoiceResult> {
    return this.quick.send(rlsContextFromPrincipal(principal), id, invoiceId, dto);
  }

  @Get(':id/invoices/:invoiceId/sends')
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.engagementReadCommercial)
  @ApiOperation({ summary: 'When the invoice went to the client, newest first' })
  sends(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ): Promise<InvoiceSendRecord[]> {
    return this.quick.sends(rlsContextFromPrincipal(principal), id, invoiceId);
  }
}

/** The firm on its invoices: details and logo. Partners change them. */
@ApiTags('quick-invoices')
@Controller('billing/firm-profile')
export class FirmProfileController {
  constructor(private readonly profile: FirmProfileService) {}

  @Get()
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.billingManage)
  @ApiOperation({ summary: 'Everything the invoice PDF prints about the firm' })
  get(@CurrentPrincipal() principal: Principal): Promise<FirmInvoiceProfile> {
    return this.profile.get(rlsContextFromPrincipal(principal));
  }

  @Patch()
  @RequirePermissions(PERMISSION.billingApprove)
  @ApiOperation({ summary: 'Change the firm’s PAN, contact and bank details (partners; audited)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: UpdateFirmProfileDto,
  ): Promise<FirmInvoiceProfile> {
    return this.profile.update(rlsContextFromPrincipal(principal), dto);
  }

  @Get('logo')
  @RequireAnyPermission(PERMISSION.engagementRead, PERMISSION.billingManage)
  @ApiOperation({ summary: 'The firm logo' })
  async logo(@CurrentPrincipal() principal: Principal): Promise<StreamableFile> {
    const l = await this.profile.logo(rlsContextFromPrincipal(principal));
    return new StreamableFile(l.data, {
      type: l.contentType,
      disposition: 'inline; filename="logo"',
    });
  }

  @Put('logo')
  @RequirePermissions(PERMISSION.billingApprove)
  @ApiOperation({ summary: 'Set the firm logo: a PNG or JPEG, at most 500 KB (partners; audited)' })
  setLogo(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: SetFirmLogoDto,
  ): Promise<FirmInvoiceProfile> {
    return this.profile.setLogo(rlsContextFromPrincipal(principal), dto);
  }

  @Delete('logo')
  @RequirePermissions(PERMISSION.billingApprove)
  @ApiOperation({ summary: 'Take the firm logo off its invoices (partners; audited)' })
  clearLogo(@CurrentPrincipal() principal: Principal): Promise<FirmInvoiceProfile> {
    return this.profile.clearLogo(rlsContextFromPrincipal(principal));
  }
}

/**
 * PUBLIC: the invoice link a client is sent. The opaque token is the
 * authorisation (only its hash is stored); it opens one issued invoice for
 * 30 days and can do nothing else.
 */
@ApiTags('invoice-links-public')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('invoice-links')
export class InvoiceLinksPublicController {
  constructor(private readonly quick: QuickInvoicesService) {}

  @Get(':token')
  @Public()
  @ApiOperation({ summary: 'Public: the invoice this link opens (or that it has expired)' })
  info(@Param('token') token: string): Promise<InvoiceShareInfo> {
    return this.quick.publicInfo(token);
  }

  @Get(':token/pdf')
  @Public()
  @ApiOperation({ summary: 'Public: the invoice PDF' })
  async pdf(@Param('token') token: string): Promise<StreamableFile> {
    const pdf = await this.quick.publicPdf(token);
    return new StreamableFile(pdf.data, {
      type: 'application/pdf',
      disposition: `attachment; filename="${pdf.filename}"`,
    });
  }
}
