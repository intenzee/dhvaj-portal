import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional } from 'class-validator';
import { WORK_SECTIONS } from '@hsdg/contracts';

/**
 * `?section=gst,income_tax` on a list query: a comma list (or repeated param)
 * of WORK_SECTIONS, any-of. Unknown keys are a 400, like every other filter.
 */
export function SectionQuery(): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      enum: WORK_SECTIONS,
      isArray: true,
      description: 'Comma list of sections (streams, statutory_audit, assignment) — any-of.',
    }),
    IsOptional(),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string'
        ? value.split(',').filter(Boolean)
        : Array.isArray(value)
          ? value.flatMap((v) => String(v).split(',')).filter(Boolean)
          : value,
    ),
    IsArray(),
    IsIn(WORK_SECTIONS, { each: true }),
  );
}

/**
 * SQL: engagement `eng` is in any of the sections bound at `param` (a text[]).
 * Statutory Audit and Assignments are engagement kinds; a stream is a live
 * (not cancelled) engagement service whose catalogue service carries that
 * stream — folded legacy services carry the stream they were folded into.
 * The kind 'compliance' is never a section key, so the two never collide.
 */
export function engagementInSectionsSql(eng: string, param: string): string {
  return `(${eng}.kind = ANY(${param}::text[]) OR EXISTS (
      SELECT 1 FROM hsdg.engagement_services sec_es
        JOIN hsdg.services sec_s ON sec_s.id = sec_es.service_id
       WHERE sec_es.engagement_id = ${eng}.id AND sec_es.status <> 'cancelled'
         AND sec_s.stream = ANY(${param}::text[])))`;
}
