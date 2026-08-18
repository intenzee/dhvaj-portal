import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { PaginationQueryDto, paginate } from '../../common/pagination/pagination.dto';
import { IdentityService } from './identity.service';
import type { UserListItem } from './identity.types';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  @RequirePermissions(PERMISSION.userRead)
  @ApiOperation({
    summary: 'List users within the caller’s permitted scope',
    description:
      'Results are scoped by Row Level Security: firm-wide roles see everyone; others see only their office. The database enforces this, not the UI.',
  })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() page: PaginationQueryDto,
  ): Promise<Paginated<UserListItem>> {
    const result = await this.identity.listUsers(rlsContextFromPrincipal(principal), page);
    return paginate(result, page);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.userRead)
  @ApiOperation({
    summary: 'Get a single user by id',
    description:
      'Returns 404 if the user is outside the caller’s RLS scope — indistinguishable from not existing, so scope is not leaked.',
  })
  async getById(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<UserListItem> {
    const user = await this.identity.getUserById(rlsContextFromPrincipal(principal), id);
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return user;
  }
}
