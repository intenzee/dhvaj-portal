import type { EntityStatus, RegistrationStatus, RegistrationType } from '@hsdg/contracts';

export interface EntityTypeRecord {
  id: string;
  slug: string;
  name: string;
  category: string;
}

export interface RegistrationRecord {
  id: string;
  registrationType: RegistrationType;
  registrationNumber: string;
  stateCode: string | null;
  status: RegistrationStatus;
  validFrom: string | null;
  validTo: string | null;
}

export interface ContactRecord {
  id: string;
  fullName: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  isSignatory: boolean;
}

/** An entity as it appears in list responses. */
export interface EntitySummary {
  id: string;
  entityCode: string;
  legalName: string;
  displayName: string | null;
  typeSlug: string;
  typeName: string;
  typeCategory: string;
  pan: string | null;
  status: EntityStatus;
  officeId: string;
  officeCode: string;
  parentEntityId: string | null;
  incorporationDate: string | null;
  registrationCount: number;
  primaryContactName: string | null;
  version: number;
}

/** Full entity view: summary plus its registrations and contacts. */
export interface EntityDetail extends EntitySummary {
  registrations: RegistrationRecord[];
  contacts: ContactRecord[];
}

export interface DuplicateCandidate {
  id: string;
  entityCode: string;
  legalName: string;
  pan: string | null;
  score: number;
  matchReason: 'pan' | 'name';
}

export interface RegistrationInput {
  registrationType: RegistrationType;
  registrationNumber: string;
  stateCode?: string;
  status?: RegistrationStatus;
  validFrom?: string;
  validTo?: string;
}

export interface ContactInput {
  fullName: string;
  designation?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
  isSignatory?: boolean;
}

export interface CreateEntityInput {
  legalName: string;
  displayName?: string;
  typeSlug: string;
  officeCode: string;
  pan?: string;
  parentEntityId?: string;
  status?: EntityStatus;
  incorporationDate?: string;
  registrations?: RegistrationInput[];
  contacts?: ContactInput[];
}

export interface UpdateEntityInput {
  legalName?: string;
  displayName?: string | null;
  typeSlug?: string;
  officeCode?: string;
  pan?: string | null;
  parentEntityId?: string | null;
  status?: EntityStatus;
  incorporationDate?: string | null;
  version?: number;
}

export interface EntityFilter {
  status?: EntityStatus;
  typeSlug?: string;
  officeCode?: string;
  search?: string;
}
