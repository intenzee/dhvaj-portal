import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  AP01_OPTIONS,
  AP02_ANSWERS,
  ASSURANCE_REPORT,
  CONFIRMATION_AREAS,
  CUEC_ANSWERS,
  DEPENDENCY_IMPACTS,
  DEPENDENCY_OWNER_PARTIES,
  DEPENDENCY_STATUSES,
  DT01_OPTIONS,
  EC01_ANSWERS,
  FS_COVERED,
  IA01_OPTIONS,
  INVENTORY_DECISIONS,
  MAP_CONTROLS_STRATEGIES,
  MAP_EVIDENCE_CATEGORIES,
  MAP_TIMINGS,
  NEEDED_BY,
  OB01_OPTIONS,
  OTHER_AUDITOR_STRATEGIES,
  PARTNER_ACTIONS,
  ROLL_FORWARD,
  SC02_ANSWERS,
  SCOPE_AFFECTED_MODULES,
  SCOPE_CONCLUSIONS,
  SCOPE_REVISION_TRIGGERS,
  SCOPE_UNIT_TYPES,
  SL01_ANSWERS,
  SO01_OPTIONS,
  SPECIAL_CONSIDERATIONS,
  SPECIALIST_AREAS,
  UNIT_AUDITORS,
  UNIT_RELEVANCE,
  type Ap01Answer,
  type Ap02Answer,
  type AssuranceReport,
  type ConfirmationArea,
  type CuecAnswer,
  type DependencyImpact,
  type DependencyOwnerParty,
  type DependencyStatus,
  type Dt01Answer,
  type Ec01Answer,
  type FsCovered,
  type Ia01Answer,
  type InventoryDecision,
  type MapControlsStrategy,
  type MapEvidenceCategory,
  type MapTiming,
  type NeededBy,
  type Ob01Answer,
  type OtherAuditorStrategy,
  type PartnerScopeAction,
  type RollForward,
  type Sc02Answer,
  type ScopeConclusion,
  type ScopeReassessmentSource,
  type ScopeRevisionTrigger,
  type ScopeUnitType,
  type Sl01Answer,
  type So01Answer,
  type SpecialConsiderationTag,
  type SpecialistArea,
  type UnitAuditor,
  type UnitRelevance,
} from '@hsdg/contracts';

const AMOUNT = { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false } as const;
const TEXT = 4000;
const SHORT = 500;

/** 03.4 record — partial update (SC-01/02, AP-01, EC-01, OB-01, IA-01, DT-01, SL-01, AP-02). */
export class UpdateScopeApproachDto {
  @ApiPropertyOptional({ enum: FS_COVERED })
  @IsOptional()
  @IsIn(FS_COVERED)
  sc01?: FsCovered | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(SHORT) sc01Other?: string | null;
  @ApiPropertyOptional({ enum: SC02_ANSWERS })
  @IsOptional()
  @IsIn(SC02_ANSWERS)
  sc02?: Sc02Answer | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) sc02Note?: string | null;
  @ApiPropertyOptional({ enum: AP01_OPTIONS })
  @IsOptional()
  @IsIn(AP01_OPTIONS)
  ap01?: Ap01Answer | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) ap01Rationale?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) icfrNote?: string | null;
  @ApiPropertyOptional({ enum: EC01_ANSWERS })
  @IsOptional()
  @IsIn(EC01_ANSWERS)
  ec01?: Ec01Answer | null;
  @ApiPropertyOptional({ enum: CONFIRMATION_AREAS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CONFIRMATION_AREAS.length)
  @IsIn(CONFIRMATION_AREAS, { each: true })
  ec01Areas?: ConfirmationArea[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) ec01Note?: string | null;
  @ApiPropertyOptional({ enum: INVENTORY_DECISIONS })
  @IsOptional()
  @IsIn(INVENTORY_DECISIONS)
  inventoryDecision?: InventoryDecision | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) inventoryLocations?:
    string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) inventoryNote?: string | null;
  @ApiPropertyOptional({ enum: EC01_ANSWERS })
  @IsOptional()
  @IsIn(EC01_ANSWERS)
  physicalOther?: Ec01Answer | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) physicalOtherNote?:
    string | null;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() obInputs?: Record<
    string,
    string
  >;
  @ApiPropertyOptional({ enum: OB01_OPTIONS })
  @IsOptional()
  @IsIn(OB01_OPTIONS)
  ob01?: Ob01Answer | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) ob01Note?: string | null;
  @ApiPropertyOptional({ enum: IA01_OPTIONS })
  @IsOptional()
  @IsIn(IA01_OPTIONS)
  ia01?: Ia01Answer | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) ia01Note?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) jointAuditNote?: string | null;
  @ApiPropertyOptional({ enum: DT01_OPTIONS })
  @IsOptional()
  @IsIn(DT01_OPTIONS)
  dt01?: Dt01Answer | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) dt01Note?: string | null;
  @ApiPropertyOptional({ enum: SL01_ANSWERS })
  @IsOptional()
  @IsIn(SL01_ANSWERS)
  sl01?: Sl01Answer | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) conclusionSummary?:
    string | null;
  @ApiPropertyOptional({ enum: AP02_ANSWERS })
  @IsOptional()
  @IsIn(AP02_ANSWERS)
  ap02?: Ap02Answer | null;
  @ApiProperty() @IsInt() @Min(0) version!: number;
}

export class ScopeUnitDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(SHORT) name?: string;
  @ApiPropertyOptional({ enum: SCOPE_UNIT_TYPES })
  @IsOptional()
  @IsIn(SCOPE_UNIT_TYPES)
  unitType?: ScopeUnitType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(SHORT) location?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(SHORT) finMetric?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber(AMOUNT) finAmount?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(SHORT) finSource?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() finNotAvailable?: boolean;
  @ApiPropertyOptional({ enum: UNIT_RELEVANCE, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(UNIT_RELEVANCE.length)
  @IsIn(UNIT_RELEVANCE, { each: true })
  relevance?: UnitRelevance[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(SHORT) relevanceOther?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) qualitativeNote?: string | null;
  @ApiPropertyOptional({ isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  signalIds?: string[];
  @ApiPropertyOptional({ isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  focusIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() specificMateriality?: boolean;
  @ApiPropertyOptional({ enum: UNIT_AUDITORS })
  @IsOptional()
  @IsIn(UNIT_AUDITORS)
  auditor?: UnitAuditor;
  @ApiPropertyOptional({ enum: OTHER_AUDITOR_STRATEGIES })
  @IsOptional()
  @IsIn(OTHER_AUDITOR_STRATEGIES)
  auditorStrategy?: OtherAuditorStrategy | null;
  @ApiPropertyOptional({ enum: SCOPE_CONCLUSIONS })
  @IsOptional()
  @IsIn(SCOPE_CONCLUSIONS)
  scopeConclusion?: ScopeConclusion | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) rationale?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) version?: number;
}

export class SaveScopeDecisionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) status?: string | null;
  @ApiPropertyOptional({ enum: ROLL_FORWARD })
  @IsOptional()
  @IsIn(ROLL_FORWARD)
  rollForward?: RollForward | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) note?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) label?: string;
  @ApiProperty() @IsInt() @Min(0) version!: number;
}

export class ServiceOrgDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(SHORT)
  provider?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) process?: string | null;
  @ApiPropertyOptional({ isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  affectedAreas?: string[];
  @ApiPropertyOptional({ enum: ASSURANCE_REPORT })
  @IsOptional()
  @IsIn(ASSURANCE_REPORT)
  assuranceReport?: AssuranceReport | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(SHORT) reportDetail?: string | null;
  @ApiPropertyOptional({ enum: CUEC_ANSWERS })
  @IsOptional()
  @IsIn(CUEC_ANSWERS)
  cuec?: CuecAnswer | null;
  @ApiPropertyOptional({ enum: SO01_OPTIONS })
  @IsOptional()
  @IsIn(SO01_OPTIONS)
  so01?: So01Answer | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) note?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) version?: number;
}

export class SaveScopeConsiderationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) response!: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) note?: string | null;
  @ApiProperty() @IsInt() @Min(0) version!: number;
}

export class NewSpecialistDto {
  @ApiProperty({ enum: SPECIALIST_AREAS }) @IsIn(SPECIALIST_AREAS) area!: SpecialistArea;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(TEXT) observation!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() signalId?: string | null;
}

export class ScopeDependencyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(TEXT)
  description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(SHORT) affected?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() unitId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerEmployeeId?: string | null;
  @ApiPropertyOptional({ enum: DEPENDENCY_OWNER_PARTIES })
  @IsOptional()
  @IsIn(DEPENDENCY_OWNER_PARTIES)
  ownerParty?: DependencyOwnerParty;
  @ApiPropertyOptional({ enum: NEEDED_BY })
  @IsOptional()
  @IsIn(NEEDED_BY)
  neededBy?: NeededBy | null;
  @ApiPropertyOptional({ enum: DEPENDENCY_IMPACTS })
  @IsOptional()
  @IsIn(DEPENDENCY_IMPACTS)
  impact?: DependencyImpact;
  @ApiPropertyOptional({ enum: DEPENDENCY_STATUSES })
  @IsOptional()
  @IsIn(DEPENDENCY_STATUSES)
  status?: DependencyStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) resolution?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) version?: number;
}

export class ScopeLimitationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(TEXT) matter?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(SHORT) affected?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) managementPosition?:
    string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) alternativeEvidence?:
    string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerEmployeeId?: string | null;
  @ApiPropertyOptional({ enum: ['open', 'resolved'] })
  @IsOptional()
  @IsIn(['open', 'resolved'])
  status?: 'open' | 'resolved';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) resolution?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) version?: number;
}

export class ScopeMapItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber(AMOUNT) manualAmount?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) materialityNote?: string | null;
  @ApiPropertyOptional({ isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  signalIds?: string[];
  @ApiPropertyOptional({ isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  focusIds?: string[];
  @ApiPropertyOptional({ enum: MAP_CONTROLS_STRATEGIES })
  @IsOptional()
  @IsIn(MAP_CONTROLS_STRATEGIES)
  controlsStrategy?: MapControlsStrategy | null;
  @ApiPropertyOptional({ enum: MAP_TIMINGS })
  @IsOptional()
  @IsIn(MAP_TIMINGS)
  timing?: MapTiming | null;
  @ApiPropertyOptional({ enum: MAP_EVIDENCE_CATEGORIES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAP_EVIDENCE_CATEGORIES.length)
  @IsIn(MAP_EVIDENCE_CATEGORIES, { each: true })
  evidenceChannels?: MapEvidenceCategory[];
  @ApiPropertyOptional({ enum: SPECIAL_CONSIDERATIONS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SPECIAL_CONSIDERATIONS.length)
  @IsIn(SPECIAL_CONSIDERATIONS, { each: true })
  specialConsiderations?: SpecialConsiderationTag[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) note?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() included?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) exclusionReason?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() reassessed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) version?: number;
}

export class PartnerScopeActionDto {
  @ApiProperty({ enum: PARTNER_ACTIONS }) @IsIn(PARTNER_ACTIONS) action!: PartnerScopeAction;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) note?: string | null;
}

export class RespondPartnerActionDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(TEXT) response!: string;
  @ApiProperty() @IsInt() @Min(0) version!: number;
}

export class StartScopeRevisionDto {
  @ApiProperty({ enum: SCOPE_REVISION_TRIGGERS })
  @IsIn(SCOPE_REVISION_TRIGGERS)
  trigger!: ScopeRevisionTrigger;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(TEXT) reason!: string;
  @ApiPropertyOptional({ isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(SCOPE_AFFECTED_MODULES, { each: true })
  affectedModules?: string[];
}

export class FlagScopeReassessmentDto {
  @ApiProperty({ enum: ['materiality_revision', 'section_05', 'manager', 'other'] })
  @IsIn(['materiality_revision', 'section_05', 'manager', 'other'])
  source!: ScopeReassessmentSource;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(TEXT) reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) cycleKey?: string | null;
}
