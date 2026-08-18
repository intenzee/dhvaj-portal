import { types } from 'pg';

/**
 * PostgreSQL type parser overrides. Imported for its side effects by the
 * DatabaseModule so it applies to the app and to tests alike.
 *
 * DATE (OID 1082): node-postgres parses a bare `date` into a JS Date at the
 * server's LOCAL midnight, which then shifts across the UTC boundary when
 * serialised (e.g. `2024-06-01` becomes `2024-05-31` in IST). A `date` has no
 * time or zone, so we keep it as the raw `YYYY-MM-DD` string instead.
 */
types.setTypeParser(types.builtins.DATE, (value: string) => value);
