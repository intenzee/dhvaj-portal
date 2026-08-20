import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppConfigService } from '../../config/config.module';
import { IdentityService } from '../identity/identity.service';
import { AuditService } from '../audit/audit.service';
import { pickEffectiveRole } from './auth.service';
import { DevAuthProvider } from './dev-auth.provider';
import { CurrentPrincipal, Public, RequirePermissions } from './auth.decorators';
import { rlsContextFromPrincipal, type Principal } from './principal';
import { DevTokenDto } from './dto/dev-token.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly config: AppConfigService,
    private readonly identity: IdentityService,
    private readonly devProvider: DevAuthProvider,
    private readonly audit: AuditService,
  ) {}

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
