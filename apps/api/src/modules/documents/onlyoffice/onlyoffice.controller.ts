import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../auth/auth.decorators';
import { OnlyOfficeService } from './onlyoffice.service';

/**
 * Server-to-server endpoints the OnlyOffice Document Server calls directly (not
 * the browser). They are `@Public()` — carrying no user session — but every
 * request is authorised by a signed, document-scoped token, and the callback is
 * additionally verified against the shared DS secret. See {@link OnlyOfficeService}.
 */
@ApiExcludeController()
@Controller('documents/onlyoffice')
export class OnlyOfficeController {
  constructor(private readonly onlyoffice: OnlyOfficeService) {}

  @Public()
  @Get('content')
  async content(@Query('token') token: string): Promise<StreamableFile> {
    const file = await this.onlyoffice.readForToken(token);
    const safeName = file.filename.replace(/["\r\n]/g, '_');
    return new StreamableFile(file.buffer, {
      type: file.contentType,
      disposition: `attachment; filename="${safeName}"`,
      length: file.sizeBytes,
    });
  }

  @Public()
  @Post('callback')
  @HttpCode(200)
  async callback(
    @Query('token') token: string,
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ): Promise<{ error: 0 }> {
    return this.onlyoffice.handleCallback(token, body ?? {}, authorization);
  }
}
