import type { IPublicClientApplication } from '@azure/msal-browser';

/**
 * Microsoft Entra ID (Azure AD) sign-in — the production auth path (§13). Enabled
 * only when the tenant/app registration is configured via env, so local dev falls
 * back to the dev-token sign-in. The API validates the resulting access token
 * (AUTH_PROVIDER=entra); we never see or store a password.
 *
 * To enable, register a SPA app in your tenant and set:
 *   NEXT_PUBLIC_ENTRA_TENANT_ID   — the directory (tenant) id
 *   NEXT_PUBLIC_ENTRA_CLIENT_ID   — this SPA's application (client) id
 *   NEXT_PUBLIC_ENTRA_API_SCOPE   — the API's exposed scope, e.g.
 *                                   api://<api-client-id>/access_as_user
 */
const TENANT = process.env.NEXT_PUBLIC_ENTRA_TENANT_ID;
const CLIENT_ID = process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID;
const API_SCOPE = process.env.NEXT_PUBLIC_ENTRA_API_SCOPE;

export const isEntraConfigured = Boolean(TENANT && CLIENT_ID && API_SCOPE);

let msal: IPublicClientApplication | null = null;

async function getMsal(): Promise<IPublicClientApplication> {
  if (msal) return msal;
  const { PublicClientApplication } = await import('@azure/msal-browser');
  msal = new PublicClientApplication({
    auth: {
      clientId: CLIENT_ID!,
      authority: `https://login.microsoftonline.com/${TENANT}`,
      redirectUri: typeof window !== 'undefined' ? window.location.origin : undefined,
    },
    cache: { cacheLocation: 'sessionStorage' },
  });
  await msal.initialize();
  return msal;
}

/** Interactive Microsoft sign-in; resolves to an API access token. */
export async function entraSignIn(): Promise<string> {
  const client = await getMsal();
  const scopes = [API_SCOPE!];
  const result = await client.loginPopup({ scopes });
  const account = result.account ?? client.getAllAccounts()[0];
  const token = await client.acquireTokenSilent({ account: account!, scopes });
  return token.accessToken;
}

export async function entraSignOut(): Promise<void> {
  if (!msal) return;
  const account = msal.getAllAccounts()[0];
  await msal.logoutPopup({ account: account ?? undefined });
}
