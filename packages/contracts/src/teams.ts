/**
 * CM-8 · Client teams: a named group with one overseeing partner and any
 * number of associates, assigned to clients (one team per client, D5). The
 * team pre-fills each new engagement for its clients. Always "client team" in
 * the UI, so it is not taken for an engagement's own team.
 */

export const CLIENT_TEAM_ROLE = {
  overseeingPartner: 'overseeing_partner',
  associate: 'associate',
} as const;
export type ClientTeamRole = (typeof CLIENT_TEAM_ROLE)[keyof typeof CLIENT_TEAM_ROLE];
export const CLIENT_TEAM_ROLES: ClientTeamRole[] = Object.values(CLIENT_TEAM_ROLE);

export const CLIENT_TEAM_ROLE_LABEL: Record<ClientTeamRole, string> = {
  overseeing_partner: 'Overseeing partner',
  associate: 'Associate',
};

export const CLIENT_TEAM_NAME_MAX = 80;

/** A person as a team picker or page shows them (any office). */
export interface TeamPerson {
  id: string;
  fullName: string;
  gradeSlug: string;
  gradeName: string;
  isPartner: boolean;
  officeCode: string;
  /** False once they have left the firm or their login is deactivated. */
  active: boolean;
}

/** A client's team on Client 360 and the clients list. */
export interface ClientTeamRef {
  id: string;
  name: string;
  overseeingPartner: { id: string; fullName: string } | null;
}

export interface TeamMember extends TeamPerson {
  teamRole: ClientTeamRole;
  addedAt: string;
}

export interface TeamClient {
  id: string;
  entityCode: string;
  legalName: string;
}

/** A row of People → Teams. */
export interface TeamSummary {
  id: string;
  name: string;
  description: string | null;
  officeId: string | null;
  officeCode: string | null;
  overseeingPartner: { id: string; fullName: string } | null;
  /** Names for the initials column. */
  associates: { id: string; fullName: string }[];
  clientCount: number;
  archivedAt: string | null;
  version: number;
}

export interface TeamDetail extends TeamSummary {
  members: TeamMember[];
  clients: TeamClient[];
  /** "Rakesh Jain has left the firm", "Needs an overseeing partner". */
  warnings: string[];
}

/** POST /teams */
export interface CreateTeamInput {
  name: string;
  overseeingPartnerId: string;
  associateIds?: string[];
  officeId?: string | null;
  description?: string | null;
  /** Put the team to work in the same step. */
  entityIds?: string[];
}

/** PATCH /teams/:id */
export interface UpdateTeamInput {
  name?: string;
  description?: string | null;
  officeId?: string | null;
  version: number;
}

/** POST /teams/:id/members — an overseeing partner replaces the current one. */
export interface AddTeamMembersInput {
  employeeIds: string[];
  teamRole: ClientTeamRole;
}

/** POST /teams/:id/clients */
export interface AssignTeamClientsInput {
  entityIds: string[];
}

/** Which clients moved, and from which team. */
export interface AssignTeamClientsResult {
  assigned: {
    entityId: string;
    legalName: string;
    fromTeam: { id: string; name: string } | null;
  }[];
}

/** PUT /entities/:id/team */
export interface SetClientTeamInput {
  teamId: string | null;
  /** D7: also add the team's people to the client's open engagements. Never removes anyone. */
  applyToOpenEngagements?: boolean;
}

export interface SetClientTeamResult {
  team: ClientTeamRef | null;
  /** Open engagements the team's people were added to. */
  engagementsUpdated: number;
}
