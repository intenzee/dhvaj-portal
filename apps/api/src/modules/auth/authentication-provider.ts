/**
 * Result of verifying an inbound access token, normalised across identity
 * providers. The auth layer maps this onto a user in the identity store to
 * build a {@link Principal}.
 */
export interface VerifiedToken {
  /** Email / UPN claim, when present. */
  email?: string;
  /** Microsoft Entra ID object id (`oid`), when present. */
  entraObjectId?: string;
  /** Whether the identity provider asserts MFA was satisfied for this token. */
  mfaSatisfied: boolean;
}

/**
 * Pluggable authentication provider. Implementations verify a bearer token and
 * return normalised claims — they do NOT touch the database or build a
 * principal. Selected at runtime by configuration (`AUTH_PROVIDER`).
 */
export interface AuthenticationProvider {
  readonly name: string;
  verify(token: string): Promise<VerifiedToken>;
}

/** DI token for the currently-active provider. */
export const ACTIVE_AUTH_PROVIDER = Symbol('ACTIVE_AUTH_PROVIDER');
