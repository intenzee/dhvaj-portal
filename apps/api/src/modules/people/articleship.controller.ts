import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type Articleship,
  type ArticleshipDetail,
  type ArticleshipScheme,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { ArticleshipService } from './articleship.service';
import {
  AddArticleshipLeaveDto,
  ArticleshipListQueryDto,
  EndArticleshipDto,
  SaveArticleshipDto,
  UpdateArticleshipSchemeDto,
} from './dto/articleship.dto';

/**
 * The articleship register (spec §4.7). HR and the Managing Partner keep it;
 * an article and their principal read their own (RLS).
 */
@ApiTags('people')
@Controller('people')
export class ArticleshipController {
  constructor(private readonly articleships: ArticleshipService) {}

  @Get('articleship-schemes')
  @RequirePermissions(PERMISSION.employeeRead)
  @ApiOperation({ summary: 'The firm’s articleship schemes (period, leave allowed)' })
  schemes(@CurrentPrincipal() principal: Principal): Promise<ArticleshipScheme[]> {
    return this.articleships.schemes(rlsContextFromPrincipal(principal));
  }

  @Patch('articleship-schemes/:code')
  @RequirePermissions(PERMISSION.employeeManage)
  @ApiOperation({ summary: 'Change a scheme’s period or leave allowance (audited)' })
  updateScheme(
    @CurrentPrincipal() principal: Principal,
    @Param('code') code: string,
    @Body() dto: UpdateArticleshipSchemeDto,
  ): Promise<ArticleshipScheme> {
    return this.articleships.updateScheme(rlsContextFromPrincipal(principal), code, dto);
  }

  @Get('articles')
  @RequirePermissions(PERMISSION.employeeRead)
  @ApiOperation({ summary: 'The articleship register (RLS-scoped)' })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() q: ArticleshipListQueryDto,
  ): Promise<Articleship[]> {
    return this.articleships.list(rlsContextFromPrincipal(principal), q.status);
  }

  @Get('employees/:id/articleship')
  @RequirePermissions(PERMISSION.employeeRead)
  @ApiOperation({ summary: 'A person’s articleships, newest first, with leave' })
  forEmployee(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ArticleshipDetail[]> {
    return this.articleships.forEmployee(rlsContextFromPrincipal(principal), id);
  }

  @Put('employees/:id/articleship')
  @RequirePermissions(PERMISSION.employeeManage)
  @ApiOperation({ summary: 'Record the articleship, or edit the active one (audited)' })
  save(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SaveArticleshipDto,
  ): Promise<ArticleshipDetail> {
    return this.articleships.save(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post('employees/:id/articleship/end')
  @RequirePermissions(PERMISSION.employeeManage)
  @ApiOperation({ summary: 'Complete, transfer out or terminate the articleship (audited)' })
  end(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EndArticleshipDto,
  ): Promise<ArticleshipDetail> {
    return this.articleships.end(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post('employees/:id/articleship/leaves')
  @RequirePermissions(PERMISSION.employeeManage)
  @ApiOperation({ summary: 'Record leave against the entitlement (audited)' })
  addLeave(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddArticleshipLeaveDto,
  ): Promise<ArticleshipDetail> {
    return this.articleships.addLeave(rlsContextFromPrincipal(principal), id, dto);
  }

  @Delete('employees/:id/articleship/leaves/:leaveId')
  @RequirePermissions(PERMISSION.employeeManage)
  @ApiOperation({ summary: 'Remove a leave entry made in error (audited)' })
  removeLeave(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('leaveId', new ParseUUIDPipe()) leaveId: string,
  ): Promise<ArticleshipDetail> {
    return this.articleships.removeLeave(rlsContextFromPrincipal(principal), id, leaveId);
  }
}
