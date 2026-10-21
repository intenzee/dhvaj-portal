import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import {
  CurrentPrincipal,
  RequireAnyPermission,
  RequirePermissions,
} from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { PaginationQueryDto, paginate } from '../../common/pagination/pagination.dto';
import { IdentityService } from './identity.service';
import { onboardCeiling } from './onboard-ceiling';
import type { UserListItem } from './identity.types';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetUserRolesDto } from './dto/set-user-roles.dto';

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

  @Post()
  @RequireAnyPermission(PERMISSION.userManage, PERMISSION.userOnboard)
  @ApiOperation({
    summary: 'Create a user (audited)',
    description:
      'Requires firm-wide authority (RLS), or HR (user.onboard) giving only Article, Senior or Manager. Optionally grants roles on creation. The email must be unique.',
  })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateUserDto,
  ): Promise<UserListItem> {
    return this.identity.createUser(
      rlsContextFromPrincipal(principal),
      dto,
      onboardCeiling(principal),
    );
  }

  @Patch(':id')
  @RequireAnyPermission(PERMISSION.userManage, PERMISSION.userOnboard)
  @ApiOperation({
    summary: 'Update a user (audited, records before/after)',
    description:
      'Deactivation is a soft flag — users are never hard-deleted. HR (user.onboard) may change only other people holding nothing above Manager.',
  })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserListItem> {
    return this.identity.updateUser(
      rlsContextFromPrincipal(principal),
      id,
      dto,
      onboardCeiling(principal),
    );
  }

  @Put(':id/roles')
  @RequireAnyPermission(PERMISSION.userManage, PERMISSION.userOnboard)
  @ApiOperation({
    summary: 'Replace a user’s role set (audited)',
    description:
      'Idempotent — sets the complete role set. An empty set removes all roles. HR (user.onboard) may give only Article, Senior or Manager, never to themselves.',
  })
  setRoles(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetUserRolesDto,
  ): Promise<UserListItem> {
    return this.identity.setUserRoles(
      rlsContextFromPrincipal(principal),
      id,
      dto.roles,
      onboardCeiling(principal),
    );
  }
}
