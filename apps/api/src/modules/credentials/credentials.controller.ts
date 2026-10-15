import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type EntityCredentials,
  type RegistrationCredential,
  type RevealedCredential,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { CredentialsService } from './credentials.service';
import { CredentialListQueryDto, SaveCredentialDto } from './dto/credential.dto';

/** ADR-0035 — clients' saved portal logins. */
@ApiTags('credentials')
@Controller('credentials')
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Get()
  @RequirePermissions(PERMISSION.entityRead)
  @ApiOperation({
    summary: "A client's (or one registration's) saved logins — masked, never the secret",
  })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: CredentialListQueryDto,
  ): Promise<EntityCredentials> {
    return this.credentials.list(rlsContextFromPrincipal(principal), query);
  }

  @Put()
  @RequirePermissions(PERMISSION.credentialManage)
  @ApiOperation({ summary: "Save or replace a registration's portal login (encrypted)" })
  save(
    @CurrentPrincipal() principal: Principal,
    @Body() body: SaveCredentialDto,
  ): Promise<RegistrationCredential> {
    return this.credentials.save(rlsContextFromPrincipal(principal), {
      registrationId: body.registrationId,
      portal: body.portal ?? 'gst',
      username: body.username,
      password: body.password,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSION.credentialManage)
  @ApiOperation({ summary: 'Remove a saved login' })
  remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.credentials.remove(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/reveal')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(PERMISSION.credentialReveal)
  @ApiOperation({
    summary: 'Show a saved login',
    description:
      "The managing partner, a partner of the client's office, or the team on one of its engagements. Every reveal is logged; 60 an hour at most.",
  })
  reveal(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RevealedCredential> {
    return this.credentials.reveal(rlsContextFromPrincipal(principal), id);
  }
}
