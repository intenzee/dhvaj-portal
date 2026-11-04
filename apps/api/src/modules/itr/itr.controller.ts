import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FEATURE_FLAG,
  PERMISSION,
  type ImportItrStatementResult,
  type ItrIncome,
  type ItrReturn,
  type ItrSeason,
  type ItrVerifyReminder,
  type RecordItrIntimationResult,
} from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { ItrService } from './itr.service';
import {
  AddItrIncomeLineDto,
  EVerifyItrDto,
  ImportItrStatementDto,
  ItrSeasonQueryDto,
  MoveItrRefundDto,
  OpenItrReturnDto,
  RecordItrIntimationDto,
  RemindItrVerifyDto,
  UpdateItrIncomeLineDto,
  UpdateItrReturnDto,
} from './dto/itr.dto';

/**
 * Practice Services PS-403 — the ITR desk, behind ff_itr_desk (404 when off
 * for the caller's office). Reads need engagement.read and RLS decides which
 * engagements; the engagement's team writes (RLS). Bulk assign and remind on
 * the grid are the filing run's (POST /compliance/runs/assign, /remind).
 */
@ApiTags('itr')
@Controller('itr')
@RequirePermissions(PERMISSION.engagementRead)
export class ItrController {
  constructor(
    private readonly itr: ItrService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get('season')
  @ApiOperation({ summary: "The year's ITRs on individuals, HUFs and proprietors" })
  season(@CurrentPrincipal() p: Principal, @Query() q: ItrSeasonQueryDto): Promise<ItrSeason> {
    this.gate(p);
    return this.itr.season(
      rlsContextFromPrincipal(p),
      q.financialYear,
      q.scope === 'all' ? undefined : q.scope,
    );
  }

  @Post('returns')
  @HttpCode(200)
  @ApiOperation({ summary: 'Open the return on an ITR filing (or the one already open)' })
  open(@CurrentPrincipal() p: Principal, @Body() dto: OpenItrReturnDto): Promise<ItrReturn> {
    this.gate(p);
    return this.itr.open(rlsContextFromPrincipal(p), dto.complianceInstanceId);
  }

  @Get('returns/:id')
  get(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ItrReturn> {
    this.gate(p);
    return this.itr.get(rlsContextFromPrincipal(p), id);
  }

  @Patch('returns/:id')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateItrReturnDto,
  ): Promise<ItrReturn> {
    this.gate(p);
    return this.itr.update(rlsContextFromPrincipal(p), id, dto);
  }

  @Post('returns/:id/e-verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record the e-verification of a filed return' })
  eVerify(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EVerifyItrDto,
  ): Promise<ItrReturn> {
    this.gate(p);
    return this.itr.eVerify(rlsContextFromPrincipal(p), id, dto);
  }

  @Post('returns/:id/remind-verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remind the client to e-verify (the firm’s channel, or the one named)' })
  remindVerify(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RemindItrVerifyDto,
  ): Promise<ItrVerifyReminder> {
    this.gate(p);
    return this.itr.remindVerify(rlsContextFromPrincipal(p), id, dto);
  }

  @Post('returns/:id/refund')
  @HttpCode(200)
  @ApiOperation({ summary: 'Move the refund (due → credited / set off / failed)' })
  refund(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MoveItrRefundDto,
  ): Promise<ItrReturn> {
    this.gate(p);
    return this.itr.moveRefund(rlsContextFromPrincipal(p), id, dto);
  }

  @Post('returns/:id/intimation')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record a 143(1) intimation or a 245 set-off (opens a notice)' })
  intimation(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RecordItrIntimationDto,
  ): Promise<RecordItrIntimationResult> {
    this.gate(p);
    return this.itr.intimation(
      rlsContextFromPrincipal(p),
      id,
      dto,
      p.permissions.includes(PERMISSION.noticeManage),
    );
  }

  @Get('returns/:id/income')
  @ApiOperation({ summary: 'The income lines and how the sources match' })
  income(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ItrIncome> {
    this.gate(p);
    return this.itr.income(rlsContextFromPrincipal(p), id);
  }

  @Post('returns/:id/statements')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Import a 26AS text export, or an AIS / TIS / client CSV or Excel sheet',
  })
  importStatement(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ImportItrStatementDto,
  ): Promise<ImportItrStatementResult> {
    this.gate(p);
    return this.itr.importStatement(rlsContextFromPrincipal(p), id, dto);
  }

  @Post('returns/:id/lines')
  addLine(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddItrIncomeLineDto,
  ): Promise<ItrIncome> {
    this.gate(p);
    return this.itr.addLine(rlsContextFromPrincipal(p), id, dto);
  }

  @Patch('returns/:id/lines/:lineId')
  updateLine(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
    @Body() dto: UpdateItrIncomeLineDto,
  ): Promise<ItrIncome> {
    this.gate(p);
    return this.itr.updateLine(rlsContextFromPrincipal(p), id, lineId, dto);
  }

  @Delete('returns/:id/lines/:lineId')
  deleteLine(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
  ): Promise<ItrIncome> {
    this.gate(p);
    return this.itr.deleteLine(rlsContextFromPrincipal(p), id, lineId);
  }

  private gate(p: Principal): void {
    if (!this.flags.isOnFor(FEATURE_FLAG.itrDesk, p.officeCode)) {
      throw new NotFoundException();
    }
  }
}
