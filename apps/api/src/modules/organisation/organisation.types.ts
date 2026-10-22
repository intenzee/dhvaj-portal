import type { EmploymentStatus, GradeSlug } from '@hsdg/contracts';

/**
 * Someone who can lead an engagement (manager grade or above), firm-wide.
 * Deliberately narrow: what the Engagement Partner / Manager picker shows.
 */
export interface EngagementLeadCandidate {
  id: string;
  fullName: string;
  gradeSlug: GradeSlug;
  gradeName: string;
  isPartner: boolean;
  officeCode: string;
}

/** An employee as exposed by the API (RLS decides which are visible). */
export interface EmployeeRecord {
  id: string;
  employeeCode: string;
  fullName: string;
  userId: string | null;
  userEmail: string | null;
  gradeSlug: GradeSlug;
  gradeName: string;
  isPartner: boolean;
  officeId: string;
  officeCode: string;
  reportsToId: string | null;
  reportsToName: string | null;
  employmentStatus: EmploymentStatus;
  dateOfJoining: string;
  dateOfExit: string | null;
  membershipNo: string | null;
  partnerSince: string | null;
  /** Optimistic-concurrency token; increments on every update. */
  version: number;
}

export interface EmployeeFilter {
  status?: EmploymentStatus;
  gradeSlug?: GradeSlug;
  officeCode?: string;
}

export interface CreateEmployeeInput {
  employeeCode: string;
  fullName: string;
  gradeSlug: GradeSlug;
  officeCode: string;
  dateOfJoining: string;
  userId?: string;
  reportsToId?: string;
  employmentStatus?: EmploymentStatus;
  membershipNo?: string;
  partnerSince?: string;
}

export interface UpdateEmployeeInput {
  fullName?: string;
  gradeSlug?: GradeSlug;
  officeCode?: string;
  reportsToId?: string | null;
  employmentStatus?: EmploymentStatus;
  dateOfExit?: string | null;
  userId?: string | null;
  /** Partner profile (partner grade only). */
  membershipNo?: string | null;
  partnerSince?: string | null;
  /** Expected current version. If given and stale, the update fails with 409. */
  version?: number;
}
