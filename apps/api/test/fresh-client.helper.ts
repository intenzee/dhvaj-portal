import { Client } from 'pg';

/**
 * A client of its own for a test that creates a Compliance engagement.
 *
 * A client has one open Compliance engagement (spec Change 1), and the suite
 * never truncates, so a second GST / ITR / TDS engagement against the seeded
 * Bharat or Acme would be refused. This copies the seeded client — type,
 * office, turnover and registrations (numbers suffixed, they are unique) — as
 * the superuser, under a name the seeded-client searches do not match.
 */
export async function freshClient(sourceEntityId: string): Promise<string> {
  const url = process.env.DATABASE_SUPERUSER_URL;
  if (!url) throw new Error('DATABASE_SUPERUSER_URL is required for test seeding.');
  const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.entities
         (legal_name, display_name, entity_type_id, home_office_id, status, incorporation_date,
          annual_turnover, client_id, roc, listing_status, act_manufacturing, act_trading,
          act_services, act_import, act_export)
       SELECT 'E2E client ' || $2 || ' (' || entity_code || ')', 'E2E ' || $2, entity_type_id,
              home_office_id, status, incorporation_date, annual_turnover, client_id, roc,
              listing_status, act_manufacturing, act_trading, act_services, act_import, act_export
         FROM hsdg.entities WHERE id = $1
       RETURNING id`,
      [sourceEntityId, tag],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`freshClient: entity ${sourceEntityId} not found.`);
    await client.query(
      `INSERT INTO hsdg.entity_registrations
         (entity_id, registration_type, registration_number, state_code, status)
       SELECT $2, registration_type, registration_number || '-' || $3, state_code, status
         FROM hsdg.entity_registrations WHERE entity_id = $1`,
      [sourceEntityId, id, tag],
    );
    await client.query('COMMIT');
    return id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}
