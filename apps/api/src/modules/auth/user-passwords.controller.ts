import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from './auth.decorators';
import { PasswordLoginService, type PasswordStatus } from './password-login.service';
import type { Principal } from './principal';

/** Admins give staff portal passwords (user.manage). Hashes never leave the API. */
@ApiTags('users')
@Controller()
export class UserPasswordsController {
  constructor(private readonly passwords: PasswordLoginService) {}

  @Get('user-passwords')
  @RequirePermissions(PERMISSION.userManage)
  @ApiOperation({
    summary: 'Which users have a portal password',
    description: 'A map of user id → { mustChange, locked }. Users without a password are absent.',
  })
  statuses(): Promise<Record<string, PasswordStatus>> {
    return this.passwords.statuses();
  }

  @Post('users/:id/password')
  @RequirePermissions(PERMISSION.userManage)
  @ApiOperation({
    summary: 'Give a user a new temporary portal password (audited)',
    description:
      'Returns the temporary password once; it is never shown again. The user must choose their own at first sign-in. Ends their password sessions and lifts any lock.',
  })
  setTemporary(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ temporaryPassword: string }> {
    return this.passwords.setTemporary(principal, id);
  }

  @Delete('users/:id/password')
  @HttpCode(204)
  @RequirePermissions(PERMISSION.userManage)
  @ApiOperation({ summary: 'Turn off password sign-in for a user (audited)' })
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.passwords.remove(principal, id);
  }
}
