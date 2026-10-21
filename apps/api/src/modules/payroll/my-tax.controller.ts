import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type ExitSettlement,
  type Form130PartB,
  type TaxDeclaration,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { PayrollExitsService } from './payroll-exits.service';
import { SaveDeclarationDto, SubmitProofDto, TaxYearParamDto } from './payroll-tax.dto';
import { PayrollTaxService } from './payroll-tax.service';

/** A person's own tax: declaration, proofs, Form 130 Part B; a leaver's settlement. */
@ApiTags('payroll')
@Controller('me')
@RequirePermissions(PERMISSION.payrollReadOwn)
export class MyTaxController {
  constructor(
    private readonly tax: PayrollTaxService,
    private readonly exits: PayrollExitsService,
  ) {}

  @Get('tax/:year')
  @ApiOperation({ summary: 'My declaration for the year, with its proofs' })
  declaration(
    @CurrentPrincipal() principal: Principal,
    @Param() p: TaxYearParamDto,
  ): Promise<TaxDeclaration> {
    return this.tax.ownDeclaration(rlsContextFromPrincipal(principal), p.year);
  }

  @Put('tax/:year')
  @ApiOperation({ summary: 'Declare (the regime is fixed once a run has taxed me)' })
  save(
    @CurrentPrincipal() principal: Principal,
    @Param() p: TaxYearParamDto,
    @Body() dto: SaveDeclarationDto,
  ): Promise<TaxDeclaration> {
    return this.tax.saveDeclaration(rlsContextFromPrincipal(principal), p.year, null, {
      version: dto.version,
      regime: dto.regime,
      amounts: dto.amounts,
      previousEmployment: dto.previousEmployment ?? null,
    });
  }

  @Post('tax/:year/proofs')
  @ApiOperation({ summary: 'Hand in a proof (filed in the HR vault)' })
  submitProof(
    @CurrentPrincipal() principal: Principal,
    @Param() p: TaxYearParamDto,
    @Body() dto: SubmitProofDto,
  ): Promise<TaxDeclaration> {
    return this.tax.submitProof(rlsContextFromPrincipal(principal), p.year, null, dto);
  }

  @Get('tax/:year/form130')
  @ApiOperation({ summary: 'My Form 130 Part B figures (final once the year is closed)' })
  form130(
    @CurrentPrincipal() principal: Principal,
    @Param() p: TaxYearParamDto,
  ): Promise<Form130PartB> {
    return this.tax.ownForm130(rlsContextFromPrincipal(principal), p.year);
  }

  @Get('full-and-final')
  @ApiOperation({ summary: 'My full and final statement, once approved' })
  fullAndFinal(@CurrentPrincipal() principal: Principal): Promise<ExitSettlement | null> {
    return this.exits.own(rlsContextFromPrincipal(principal));
  }
}
