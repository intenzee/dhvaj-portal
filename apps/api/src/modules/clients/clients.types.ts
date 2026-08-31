import type { ClientKind, ClientStatus } from '@hsdg/contracts';

/** A client (commercial relationship, §2) as it appears in list responses. */
export interface ClientSummary {
  id: string;
  clientCode: string;
  name: string;
  shortName: string | null;
  clientKind: ClientKind;
  status: ClientStatus;
  officeId: string;
  officeCode: string;
  groupId: string | null;
  entityCount: number;
  version: number;
}

export interface ClientEntityRef {
  id: string;
  entityCode: string;
  legalName: string;
}

/** Full client view: summary plus the entities linked to it. */
export interface ClientDetail extends ClientSummary {
  entities: ClientEntityRef[];
}

export interface CreateClientInput {
  name: string;
  shortName?: string;
  clientKind?: ClientKind;
  officeCode: string;
  groupId?: string;
  status?: ClientStatus;
}

export interface UpdateClientInput {
  name?: string;
  shortName?: string | null;
  clientKind?: ClientKind;
  officeCode?: string;
  groupId?: string | null;
  status?: ClientStatus;
  version?: number;
}

export interface ClientFilter {
  status?: ClientStatus;
  kind?: ClientKind;
  officeCode?: string;
  search?: string;
}
