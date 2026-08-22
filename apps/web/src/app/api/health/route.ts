/**
 * Container liveness/readiness probe for the web app. Static, unauthenticated,
 * and independent of the API — it only reports that Next.js is serving.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok' });
}
