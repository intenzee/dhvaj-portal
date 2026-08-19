import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../../auth/principal';
import { PaginationQueryDto, paginate } from '../../../common/pagination/pagination.dto';
import type { EngagementDetail } from '../engagements.types';
import { EngagementReviewsService } from './engagement-reviews.service';
import type { ReviewRecord } from './reviews.types';
import { RecordReviewDto } from './dto/record-review.dto';
import { SignOffDto } from './dto/sign-off.dto';
import { ResolveReviewPointDto } from './dto/resolve-review-point.dto';
import { SetReviewPlanDto } from './dto/set-review-plan.dto';

/**
 * The review & sign-off engine (Phase 7). Explicit, audited commands — never a
 * generic status patch. The completion gate (POST /engagements/:id/complete)
 * reads the review state these endpoints maintain.
 */
@ApiTags('engagement-reviews')
@Controller('engagements')
export class EngagementReviewsController {
  constructor(private readonly reviews: EngagementReviewsService) {}

  @Get(':id/reviews')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'The engagement review & sign-off history (paginated)',
    description: 'Every manager/EP review and sign-off, newest first, each with its review points.',
  })
  listReviews(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<ReviewRecord>> {
    return this.reviews
      .listReviews(rlsContextFromPrincipal(principal), id, query)
      .then((result) => paginate(result, query));
  }

  @Post(':id/reviews')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Record a manager or EP review (audited)',
    description:
      'An EP review may only be recorded by the accountable Engagement Partner. Review points ' +
      'raised here are open and block completion until resolved.',
  })
  recordReview(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RecordReviewDto,
  ): Promise<EngagementDetail> {
    return this.reviews.recordReview(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post(':id/sign-off')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Perform the terminal sign-off (audited)',
    description:
      'Who may sign off is set by the effective review model: EP-required models (key-matter / ' +
      'full EP) demand the accountable Engagement Partner; a manager-review model admits any lead. ' +
      'Blocked while review points are open.',
  })
  signOff(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SignOffDto,
  ): Promise<EngagementDetail> {
    return this.reviews.signOff(rlsContextFromPrincipal(principal), id, dto);
  }

  @Post(':id/review-points/:pointId/resolve')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Resolve an open review point (audited)' })
  resolveReviewPoint(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('pointId', new ParseUUIDPipe()) pointId: string,
    @Body() dto: ResolveReviewPointDto,
  ): Promise<EngagementDetail> {
    return this.reviews.resolveReviewPoint(rlsContextFromPrincipal(principal), id, pointId, dto);
  }

  @Post(':id/review-plan')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: "Escalate the engagement's review plan (audited)",
    description:
      'Choose a more rigorous review model than the service default. Escalate-only — a model ' +
      'weaker than the service requires is rejected.',
  })
  setReviewPlan(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetReviewPlanDto,
  ): Promise<EngagementDetail> {
    return this.reviews.setReviewPlan(rlsContextFromPrincipal(principal), id, dto);
  }
}
