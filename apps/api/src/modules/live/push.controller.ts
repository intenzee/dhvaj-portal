import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { PushConfig } from '@hsdg/contracts';
import { CurrentPrincipal } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { notLinkedToEmployee } from '../../common/errors/staff-link.messages';
import { PushService } from './push.service';

class PushKeysDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) p256dh!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) auth!: string;
}

export class PushSubscribeDto {
  @ApiProperty()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  endpoint!: string;
  @ApiProperty({ type: PushKeysDto })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
  /** Sent by PushSubscription.toJSON(); not kept. */
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  expirationTime?: number | null;
}

export class PushUnsubscribeDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(1000) endpoint!: string;
}

@ApiTags('push')
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('config')
  @ApiOperation({ summary: 'Whether alerts can reach closed browsers, and the VAPID public key' })
  config(): PushConfig {
    return this.push.config();
  }

  @Get('me')
  @ApiOperation({ summary: 'How many devices the signed-in person gets alerts on' })
  async me(@CurrentPrincipal() principal: Principal): Promise<{ devices: number }> {
    return { devices: await this.push.myDevices(this.ctx(principal, 'see your alert devices')) };
  }

  @Post('subscriptions')
  @HttpCode(204)
  @ApiOperation({ summary: 'Get quick-task alerts on this browser even when it is closed' })
  async subscribe(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: PushSubscribeDto,
    @Headers('user-agent') ua?: string,
  ): Promise<void> {
    await this.push.subscribe(this.ctx(principal, 'turn on alerts'), dto, ua);
  }

  @Delete('subscriptions')
  @HttpCode(204)
  @ApiOperation({ summary: 'Stop alerts to this browser' })
  async unsubscribe(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: PushUnsubscribeDto,
  ): Promise<void> {
    await this.push.unsubscribe(this.ctx(principal, 'turn off alerts'), dto.endpoint);
  }

  private ctx(principal: Principal, action: string) {
    if (!principal.employeeId) throw new ForbiddenException(notLinkedToEmployee(action));
    return rlsContextFromPrincipal(principal);
  }
}
