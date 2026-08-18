import type { EmploymentStatus, GradeSlug } from '@hsdg/contracts';

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
}

export interface UpdateEmployeeInput {
  fullName?: string;
  gradeSlug?: GradeSlug;
  officeCode?: string;
  reportsToId?: string | null;
  employmentStatus?: EmploymentStatus;
  dateOfExit?: string | null;
}
