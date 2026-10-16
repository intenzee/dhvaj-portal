import { Body, Controller, HttpCode, NotFoundException, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FEATURE_FLAG, PERMISSION, type NoticeIntakeResponse } from '@hsdg/contracts';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { NoticeIntakeDto } from './dto/notice-intake.dto';
import { NoticeIntakeService } from './notice-intake.service';

@ApiTags('notices')
@Controller('notices')
export class NoticeIntakeController {
  constructor(
    private readonly intake: NoticeIntakeService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Post('intake')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.noticeManage)
  @ApiOperation({
    summary: 'Suggest a notice’s fields from its uploaded PDF (PS-104); nothing is saved',
    description:
      'Reads the document’s OCR text (documents.extracted_text) and returns suggestions with a ' +
      'confidence and the text each was read from — GSTIN / PAN, reference number or DIN, issue ' +
      'and reply dates, section, form, amount, FY / AY, tax period — the library code that fits, ' +
      'and the clients whose GSTIN (entity_registrations) or PAN (entities.pan) match, with their ' +
      'open engagements. ocrStatus pending ⇒ poll again; not_applicable ⇒ no text (OCR off or ' +
      'an unsupported file). A document the caller cannot see is 404. Behind ff_notices.',
  })
  run(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: NoticeIntakeDto,
  ): Promise<NoticeIntakeResponse> {
    if (!this.flags.isOnFor(FEATURE_FLAG.notices, principal.officeCode)) {
      throw new NotFoundException('Notices are not switched on for your office yet.');
    }
    return this.intake.suggest(rlsContextFromPrincipal(principal), dto.documentId);
  }
}
