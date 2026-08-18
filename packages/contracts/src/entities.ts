/** Entity (client) vocabulary shared by the API and web. */

export const ENTITY_STATUS = {
  prospect: 'prospect',
  active: 'active',
  inactive: 'inactive',
  archived: 'archived',
} as const;
export type EntityStatus = (typeof ENTITY_STATUS)[keyof typeof ENTITY_STATUS];
export const ENTITY_STATUSES: EntityStatus[] = Object.values(ENTITY_STATUS);

/** Statutory registration kinds. PAN lives on the entity itself. */
export const REGISTRATION_TYPE = {
  gstin: 'gstin',
  cin: 'cin',
  llpin: 'llpin',
  tan: 'tan',
  iec: 'iec',
  pt: 'pt',
  esic: 'esic',
  pf: 'pf',
  other: 'other',
} as const;
export type RegistrationType = (typeof REGISTRATION_TYPE)[keyof typeof REGISTRATION_TYPE];
export const REGISTRATION_TYPES: RegistrationType[] = Object.values(REGISTRATION_TYPE);

export const REGISTRATION_STATUS = {
  active: 'active',
  inactive: 'inactive',
  cancelled: 'cancelled',
  suspended: 'suspended',
} as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUS)[keyof typeof REGISTRATION_STATUS];
export const REGISTRATION_STATUSES: RegistrationStatus[] = Object.values(REGISTRATION_STATUS);

/** Indian identifier formats (uppercase). */
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/;
export const TAN_REGEX = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
