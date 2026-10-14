import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  COMPLIANCE_EVENT_TYPES,
  FILING_STATUSES,
  GST_SCHEMES,
  PROFILE_SCOPES,
  STREAMS,
  type ComplianceEventType,
  type FilingStatus,
  type GstScheme,
  type ProfileScope,
  type QrmpCategory,
  type Stream,
} from '@hsdg/contracts';

const FY = /^[0-9]{4}-[0-9]{2}$/;
const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;
const toList = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.split(',').filter(Boolean) : value;

/** GET /compliance/calendar (and .xlsx). Defaults: this month → 11 months on. */
export class ComplianceCalendarV2QueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2027-09-30' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: STREAMS, isArray: true, description: 'Comma list.' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsIn(STREAMS, { each: true })
  stream?: Stream[];

  @ApiPropertyOptional({ enum: FILING_STATUSES, isArray: true, description: 'Comma list.' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @IsIn(FILING_STATUSES, { each: true })
  status?: FilingStatus[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  managerId?: string;

  @ApiPropertyOptional({ description: 'Servicing office code.' })
  @IsOptional()
  @IsString()
  officeCode?: string;

  @ApiPropertyOptional({ description: 'Client entity id.' })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ description: 'One engagement (the Overview "next 30 days").' })
  @IsOptional()
  @IsUUID()
  engagementId?: string;

  @ApiPropertyOptional({ description: 'Only items assigned to the caller.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  mine?: boolean;

  @ApiPropertyOptional({
    default: true,
    description: 'Also list items due before `from` that are not filed (red, "Overdue n days").',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeOverdue?: boolean;
}

export class GenerateCalendarDto {
  @ApiPropertyOptional({ example: '2026-27', description: 'One year; default every open year.' })
  @IsOptional()
  @Matches(FY, { message: 'financialYear must look like 2026-27' })
  financialYear?: string;
}

export class RecordComplianceEventDto {
  @ApiProperty({ enum: COMPLIANCE_EVENT_TYPES })
  @IsIn(COMPLIANCE_EVENT_TYPES)
  eventType!: ComplianceEventType;

  @ApiProperty({ example: '2027-09-25' })
  @IsDateString()
  eventDate!: string;

  @ApiPropertyOptional({ description: 'The registration (CIN, GSTIN, TAN) the event is on.' })
  @IsOptional()
  @IsUUID()
  registrationId?: string;

  @ApiPropertyOptional({ example: '2026-27' })
  @IsOptional()
  @Matches(FY, { message: 'financialYear must look like 2026-27' })
  financialYear?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Event details: agm {auditorAppointed}, allotment {privatePlacement}, agm_extension ' +
      '{months, approvalRef}, director_change {din, name, change}, charge_creation {chargeHolder, amount}.',
  })
  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}

/** PATCH an event — what changes, and why (kept in the event's history). */
export class CorrectComplianceEventDto {
  @ApiPropertyOptional({ example: '2027-09-25' })
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @ApiPropertyOptional({ example: '2026-27' })
  @IsOptional()
  @Matches(FY, { message: 'financialYear must look like 2026-27' })
  financialYear?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Replaces the event details (same shape as recording).' })
  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;

  @ApiProperty({ example: 'The AGM was held on the 26th, not the 25th.' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/** DELETE an event — voided, not erased; the reason is kept. */
export class VoidComplianceEventDto {
  @ApiProperty({ example: 'Recorded on the wrong client.' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class SaveComplianceProfileDto {
  @ApiProperty({ enum: PROFILE_SCOPES })
  @IsIn(PROFILE_SCOPES)
  scope!: ProfileScope;

  @ApiPropertyOptional({ description: 'Required for every scope but pan.' })
  @IsOptional()
  @IsUUID()
  registrationId?: string;

  @ApiProperty({ example: '2026-10-01', description: 'Effective from (QRMP changes by quarter).' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional({ enum: GST_SCHEMES })
  @IsOptional()
  @IsIn(GST_SCHEMES)
  gstScheme?: GstScheme;

  @ApiPropertyOptional({ enum: ['X', 'Y'], description: 'Overrides the state-derived category.' })
  @IsOptional()
  @IsIn(['X', 'Y'])
  qrmpCategory?: QrmpCategory;

  @ApiPropertyOptional({ description: 'Scope attributes (see the *ProfileAttributes contracts).' })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}

export class VerifyRuleDto {
  @ApiPropertyOptional({ description: 'What was checked (notification, circular).' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
