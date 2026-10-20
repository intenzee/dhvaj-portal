import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AppConfigService } from '../../config/config.module';
import { IdentityService } from '../identity/identity.service';
import { AuditService } from '../audit/audit.service';
import { pickEffectiveRole } from './auth.service';
import { DevAuthProvider } from './dev-auth.provider';
import { CurrentPrincipal, Public, RequirePermissions } from './auth.decorators';
import { rlsContextFromPrincipal, type Principal } from './principal';
import { DevTokenDto } from './dto/dev-token.dto';
import { ChangePasswordDto, PasswordLoginDto } from './dto/password-login.dto';
import {
  PasswordLoginService,
  type PasswordLoginResult,
  type PasswordSession,
} from './password-login.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly config: AppConfigService,
    private readonly identity: IdentityService,
    private readonly devProvider: DevAuthProvider,
    private readonly audit: AuditService,
    private readonly passwords: PasswordLoginService,
  ) {}

  @Post('login')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Sign in with email + portal password',
    description:
      'Returns a session token, or { mustChangePassword: true } when the password is a temporary one — then call POST /auth/password. Five wrong passwords lock it for 15 minutes. 404 when password sign-in is turned off.',
  })
  login(@Body() dto: PasswordLoginDto): Promise<PasswordLoginResult> {
    return this.passwords.login(dto.email, dto.password);
  }

  @Post('password')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Choose a new portal password',
    description:
      'With the current (or temporary) password. Ends every other password session and returns a fresh one.',
  })
  changePassword(@Body() dto: ChangePasswordDto): Promise<PasswordSession> {
    return this.passwords.changePassword(dto.email, dto.currentPassword, dto.newPassword);
  }

  @Post('dev-token')
  @Public()
  @ApiOperation({
    summary: 'Mint a development access token (non-production only)',
    description:
      'Issues a signed token for a seeded user so the API can be exercised without a live Entra tenant. Disabled in production and when AUTH_PROVIDER is not "dev".',
  })
  async devToken(
    @Body() dto: DevTokenDto,
  ): Promise<{ accessToken: string; tokenType: 'Bearer'; expiresIn: number }> {
    const devEnabled = this.config.get('AUTH_PROVIDER') === 'dev' || this.config.devFallbackEnabled;
    if (this.config.isProduction || !devEnabled) {
      // Hide the endpoint entirely outside its intended use.
      throw new NotFoundException();
    }

    const user = await this.identity.loadPrincipalByEmail(dto.email);
    if (!user) {
      throw new NotFoundException('No such user.');
    }

    const mfa = dto.mfa ?? true;
    const { token, expiresIn } = await this.devProvider.issue(dto.email, mfa);

    await this.audit.record(
      {
        userId: user.userId,
        role: pickEffectiveRole(user.roles) ?? '',
        officeId: user.officeId,
      },
      {
        action: 'auth.dev_token_issued',
        objectType: 'user',
        objectId: user.userId,
        reason: mfa ? 'mfa-satisfied' : 'mfa-not-satisfied',
      },
    );

    return { accessToken: token, tokenType: 'Bearer', expiresIn };
  }

  @Post('renew')
  @RequirePermissions()
  @ApiOperation({
    summary: 'Renew a password session or a development token',
    description:
      'Swaps a still-valid password session (or, outside production, a dev token) for a fresh one with a full lifetime, so a signed-in session does not lapse while it is in use. 404 for Microsoft sign-in, which renews itself.',
  })
  async renew(
    @CurrentPrincipal() principal: Principal,
  ): Promise<{ accessToken: string; tokenType: 'Bearer'; expiresIn: number }> {
    if (principal.authMethod === 'password') {
      const version = await this.passwords.currentVersion(principal.userId);
      if (version === null) throw new NotFoundException();
      return this.passwords.renew(principal, version);
    }
    const devEnabled = this.config.get('AUTH_PROVIDER') === 'dev' || this.config.devFallbackEnabled;
    if (this.config.isProduction || !devEnabled) throw new NotFoundException();
    const { token, expiresIn } = await this.devProvider.issue(
      principal.email,
      principal.mfaSatisfied,
    );
    return { accessToken: token, tokenType: 'Bearer', expiresIn };
  }

  @Get('me')
  @RequirePermissions()
  @ApiOperation({
    summary: 'Return the authenticated principal',
    description: 'Requires a valid bearer token. Useful to inspect roles/permissions/office.',
  })
  me(@CurrentPrincipal() principal: Principal): {
    principal: Principal;
    context: ReturnType<typeof rlsContextFromPrincipal>;
  } {
    return { principal, context: rlsContextFromPrincipal(principal) };
  }
}
