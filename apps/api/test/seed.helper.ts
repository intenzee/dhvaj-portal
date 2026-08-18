import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * Seeds the dev identity fixtures (offices + users) as the PostgreSQL superuser,
 * which bypasses RLS — mirroring how provisioning works. Idempotent. Returns a
 * map of email → user id and office code → office id for assertions.
 */
export async function seedIdentityFixtures(): Promise<{
  userIds: Record<string, string>;
  officeIds: Record<string, string>;
}> {
  const url = process.env.DATABASE_SUPERUSER_URL;
  if (!url) throw new Error('DATABASE_SUPERUSER_URL is required for test seeding.');

  const seedSql = readFileSync(
    join(__dirname, '..', '..', '..', 'db', 'seeds', 'dev_identity.sql'),
    'utf8',
  );

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(seedSql);
    const users = await client.query<{ email: string; id: string }>(
      'SELECT email::text AS email, id FROM hsdg.users',
    );
    const offices = await client.query<{ code: string; id: string }>(
      'SELECT code, id FROM hsdg.offices',
    );
    return {
      userIds: Object.fromEntries(users.rows.map((r) => [r.email, r.id])),
      officeIds: Object.fromEntries(offices.rows.map((r) => [r.code, r.id])),
    };
  } finally {
    await client.end();
  }
}
