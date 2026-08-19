import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';

/**
 * Row Level Security, proven at the database layer — no NestJS, no HTTP.
 *
 * Connects directly as the least-privilege `hsdg_app` role and sets the security
 * context with `set_config` exactly as the application does. If these pass, the
 * database enforces access on its own; the API and UI are irrelevant to it.
 */
describe('RLS (database-level, independent of the application)', () => {
  let app: Client;
  let userIds: Record<string, string>;
  let officeIds: Record<string, string>;

  type Ctx = { userId?: string; role?: string; officeId?: string; employeeId?: string };

  /** Run a read under a security context, in a rolled-back transaction. */
  async function underContext<T>(ctx: Ctx, sql: string): Promise<T[]> {
    await app.query('BEGIN');
    try {
      await app.query('SELECT set_config($1,$2,true)', ['hsdg.user_id', ctx.userId ?? '']);
      await app.query('SELECT set_config($1,$2,true)', ['hsdg.role', ctx.role ?? '']);
      await app.query('SELECT set_config($1,$2,true)', ['hsdg.office_id', ctx.officeId ?? '']);
      await app.query('SELECT set_config($1,$2,true)', ['hsdg.employee_id', ctx.employeeId ?? '']);
      const { rows } = await app.query(sql);
      return rows as T[];
    } finally {
      await app.query('ROLLBACK');
    }
  }

  beforeAll(async () => {
    ({ userIds, officeIds } = await seedIdentityFixtures());
    app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
  });

  afterAll(async () => {
    await app?.end();
  });

  it('is fail-closed: with NO context, zero users are visible', async () => {
    const rows = await underContext<{ email: string }>({}, 'SELECT email FROM hsdg.users');
    expect(rows).toHaveLength(0);
  });

  it('scopes a Partner to their own office (North sees North, not South)', async () => {
    const rows = await underContext<{ email: string }>(
      { userId: userIds['partner.a@hsdg.in'], role: 'partner', officeId: officeIds['NORTH'] },
      'SELECT email FROM hsdg.users',
    );
    const emails = rows.map((r) => r.email);
    expect(emails).toContain('partner.a@hsdg.in');
    expect(emails).toContain('manager.x@hsdg.in');
    // Cross-office identities are invisible.
    expect(emails).not.toContain('partner.b@hsdg.in');
    expect(emails).not.toContain('senior.y@hsdg.in');
  });

  it('denies a Partner reading a cross-office user even by direct id', async () => {
    const rows = await underContext(
      { userId: userIds['partner.a@hsdg.in'], role: 'partner', officeId: officeIds['NORTH'] },
      `SELECT id FROM hsdg.users WHERE id = '${userIds['partner.b@hsdg.in']}'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('grants the Managing Partner firm-wide visibility (all users)', async () => {
    const rows = await underContext(
      { userId: userIds['mp@hsdg.in'], role: 'managing_partner', officeId: officeIds['NORTH'] },
      'SELECT id FROM hsdg.users',
    );
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  it('makes the audit trail immutable to the app role (UPDATE/DELETE denied)', async () => {
    await expect(app.query('UPDATE hsdg.audit_events SET reason = $1', ['tamper'])).rejects.toThrow(
      /permission denied/i,
    );
    await expect(app.query('DELETE FROM hsdg.audit_events')).rejects.toThrow(/permission denied/i);
  });

  it('forbids seeding the reserved "system" role (CHECK constraint)', async () => {
    const su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    try {
      await expect(
        su.query(`INSERT INTO hsdg.roles (slug, name) VALUES ('system', 'x')`),
      ).rejects.toThrow(/roles_slug_not_reserved/);
    } finally {
      await su.end();
    }
  });

  it('hides reference data (roles) without a context, reveals it with one', async () => {
    const none = await underContext({}, 'SELECT slug FROM hsdg.roles');
    expect(none).toHaveLength(0);
    const some = await underContext(
      { userId: userIds['manager.x@hsdg.in'], role: 'manager', officeId: officeIds['NORTH'] },
      'SELECT slug FROM hsdg.roles',
    );
    expect(some.length).toBeGreaterThan(0);
  });

  describe('employees (Phase 2)', () => {
    it('is fail-closed: no context ⇒ zero employees', async () => {
      const rows = await underContext<{ employee_code: string }>(
        {},
        'SELECT employee_code FROM hsdg.employees',
      );
      expect(rows).toHaveLength(0);
    });

    it('scopes a Partner to their office (North sees North employees only)', async () => {
      const rows = await underContext<{ employee_code: string }>(
        { userId: userIds['partner.a@hsdg.in'], role: 'partner', officeId: officeIds['NORTH'] },
        'SELECT employee_code FROM hsdg.employees',
      );
      const codes = rows.map((r) => r.employee_code);
      expect(codes).toContain('EMP001'); // North
      expect(codes).not.toContain('EMP004'); // South partner
      expect(codes).not.toContain('EMP006'); // South senior
    });

    it('grants the Managing Partner every employee', async () => {
      const rows = await underContext(
        { userId: userIds['mp@hsdg.in'], role: 'managing_partner', officeId: officeIds['NORTH'] },
        'SELECT id FROM hsdg.employees',
      );
      expect(rows.length).toBeGreaterThanOrEqual(8);
    });

    it('forbids the app role from writing grades (reference data)', async () => {
      await expect(
        app.query(`INSERT INTO hsdg.grades (slug, name, rank) VALUES ('x', 'X', 1)`),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  describe('entities (Phase 3)', () => {
    it('is fail-closed: no context ⇒ zero entities', async () => {
      const rows = await underContext({}, 'SELECT id FROM hsdg.entities');
      expect(rows).toHaveLength(0);
    });

    it('scopes a Partner to their office (North sees North clients only)', async () => {
      const rows = await underContext<{ legal_name: string }>(
        { userId: userIds['partner.a@hsdg.in'], role: 'partner', officeId: officeIds['NORTH'] },
        'SELECT legal_name FROM hsdg.entities',
      );
      const names = rows.map((r) => r.legal_name);
      expect(names).toContain('Acme Manufacturing Pvt Ltd');
      expect(names).not.toContain('Coastal Foods Pvt Ltd'); // South
    });

    it('hides a cross-office client’s registrations from an office-scoped role', async () => {
      const rows = await underContext<{ registration_number: string }>(
        { userId: userIds['partner.a@hsdg.in'], role: 'partner', officeId: officeIds['NORTH'] },
        'SELECT registration_number FROM hsdg.entity_registrations',
      );
      const numbers = rows.map((r) => r.registration_number);
      expect(numbers).toContain('27AAACA1234A1Z5'); // Acme (North)
      expect(numbers).not.toContain('29AACCC9012C1Z8'); // Coastal (South)
    });

    it('forbids the app role from writing entity_types (reference data)', async () => {
      await expect(
        app.query(
          `INSERT INTO hsdg.entity_types (slug, name, category) VALUES ('x', 'X', 'other')`,
        ),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  describe('service catalogue (Phase 4)', () => {
    it('is fail-closed: no context ⇒ zero services', async () => {
      const rows = await underContext({}, 'SELECT id FROM hsdg.services');
      expect(rows).toHaveLength(0);
    });

    it('is firm-wide config: any authenticated role sees all services', async () => {
      const rows = await underContext(
        { userId: userIds['senior.y@hsdg.in'], role: 'senior', officeId: officeIds['SOUTH'] },
        'SELECT id FROM hsdg.services',
      );
      expect(rows.length).toBeGreaterThanOrEqual(11);
    });

    it('denies a non-firm-wide role writing services (RLS WITH CHECK)', async () => {
      await app.query('BEGIN');
      try {
        await app.query('SELECT set_config($1,$2,true)', ['hsdg.role', 'manager']);
        await expect(
          app.query(
            `INSERT INTO hsdg.services (service_line_id, code, name, required_review_model_id, workflow_family_id)
             SELECT sl.id, 'ZZTEST', 'Z', rm.id, wf.id
             FROM hsdg.service_lines sl, hsdg.review_models rm, hsdg.workflow_families wf LIMIT 1`,
          ),
        ).rejects.toThrow(/row-level security/i);
      } finally {
        await app.query('ROLLBACK');
      }
    });

    it('forbids the app role from writing review_models (reference data)', async () => {
      await expect(
        app.query(`INSERT INTO hsdg.review_models (slug, name, rank) VALUES ('x', 'X', 99)`),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  describe('engagements — assignment-based access (Phase 5)', () => {
    // Employees behind the seeded users (fetched under a firm-wide context,
    // since employee reads are themselves RLS-scoped and fail-closed).
    const emp = async (code: string): Promise<string> => {
      const rows = await underContext<{ id: string }>(
        { role: 'managing_partner' },
        `SELECT id FROM hsdg.employees WHERE employee_code = '${code}'`,
      );
      return rows[0]!.id;
    };

    /** A context carrying an employee id (assignment-based access). */
    async function underEmp<T>(
      role: string,
      officeCode: 'NORTH' | 'SOUTH',
      employeeId: string,
      sql: string,
    ): Promise<T[]> {
      return underContext<T>({ role, officeId: officeIds[officeCode], employeeId }, sql);
    }

    it('is fail-closed: no context ⇒ zero engagements', async () => {
      const rows = await underContext({}, 'SELECT id FROM hsdg.engagements');
      expect(rows).toHaveLength(0);
    });

    it('shows the EP their engagement', async () => {
      const partnerA = await emp('EMP003');
      const rows = await underEmp<{ engagement_code: string }>(
        'partner',
        'NORTH',
        partnerA,
        `SELECT engagement_code FROM hsdg.engagements`,
      );
      expect(rows.map((r) => r.engagement_code)).toContain('ENG00001'); // Acme audit
    });

    it('gives a cross-office team member access to the engagement, its client, and co-workers', async () => {
      // Senior Y is in the SOUTH office but is on the team of the NORTH Acme engagement.
      const seniorY = await emp('EMP006');

      const engagements = await underEmp<{ engagement_code: string }>(
        'senior',
        'SOUTH',
        seniorY,
        `SELECT engagement_code FROM hsdg.engagements`,
      );
      expect(engagements.map((r) => r.engagement_code)).toContain('ENG00001');

      // The North client Acme — normally invisible to a South user — is visible via the engagement.
      const clients = await underEmp<{ legal_name: string }>(
        'senior',
        'SOUTH',
        seniorY,
        `SELECT legal_name FROM hsdg.entities WHERE pan = 'AAACA1234A'`,
      );
      expect(clients).toHaveLength(1);

      // North co-workers on the engagement are visible.
      const coworkers = await underEmp<{ employee_code: string }>(
        'senior',
        'SOUTH',
        seniorY,
        `SELECT employee_code FROM hsdg.employees WHERE employee_code IN ('EMP003', 'EMP005')`,
      );
      expect(coworkers.map((r) => r.employee_code).sort()).toEqual(['EMP003', 'EMP005']);
    });

    it('does NOT show an unassigned partner another partner’s engagement', async () => {
      // Partner B (South) is not on the Acme (North) engagement.
      const partnerB = await emp('EMP004');
      const rows = await underEmp<{ engagement_code: string }>(
        'partner',
        'SOUTH',
        partnerB,
        `SELECT engagement_code FROM hsdg.engagements`,
      );
      expect(rows.map((r) => r.engagement_code)).not.toContain('ENG00001');
    });

    it('grants the Managing Partner every engagement (firm-wide)', async () => {
      const rows = await underContext(
        { role: 'managing_partner', officeId: officeIds['NORTH'] },
        `SELECT id FROM hsdg.engagements`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });

    it('the SECURITY DEFINER helpers are not an information side channel', async () => {
      // The helpers answer only "does MY context grant access"; they never leak
      // other rows or reveal existence. Same argument → true for the assigned
      // EP, false for an unassigned partner and for a non-existent id.
      const acme = await underContext<{ id: string }>(
        { role: 'managing_partner' },
        `SELECT id FROM hsdg.engagements WHERE engagement_code = 'ENG00001'`,
      );
      const acmeId = acme[0]!.id;
      const partnerA = await emp('EMP003'); // the Acme EP
      const partnerB = await emp('EMP004'); // unassigned to Acme

      const asEp = await underEmp<{ v: boolean }>(
        'partner',
        'NORTH',
        partnerA,
        `SELECT hsdg.is_engagement_lead('${acmeId}') AS v`,
      );
      expect(asEp[0]!.v).toBe(true);

      const asUnassigned = await underEmp<{ lead: boolean; member: boolean; ghost: boolean }>(
        'partner',
        'SOUTH',
        partnerB,
        `SELECT hsdg.is_engagement_lead('${acmeId}') AS lead,
                hsdg.is_engagement_member('${acmeId}') AS member,
                hsdg.is_engagement_lead('00000000-0000-0000-0000-000000000000') AS ghost`,
      );
      expect(asUnassigned[0]).toEqual({ lead: false, member: false, ghost: false });
    });
  });

  // The Phase 0–5 checkpoint separated business firm-wide authority (Managing
  // Partner) from technical/platform administration (admin). Admin keeps
  // identity/HR/config/audit reach but must NOT have automatic access to
  // client/engagement data. Enforced at the database layer (migration 0009).
  describe('role separation: platform admin vs business firm-wide (checkpoint)', () => {
    // Lazy: officeIds is only populated in beforeAll, after describe collection.
    const adminNorth = (): Ctx => ({ role: 'admin', officeId: officeIds['NORTH'] });

    it('denies the platform admin business firm-wide reach into engagements', async () => {
      // admin is not assigned to any engagement and is not business-firm-wide.
      const rows = await underContext(adminNorth(), `SELECT id FROM hsdg.engagements`);
      expect(rows).toHaveLength(0);
    });

    it('denies the platform admin cross-office client visibility (not firm-wide)', async () => {
      const rows = await underContext<{ legal_name: string }>(
        adminNorth(),
        `SELECT legal_name FROM hsdg.entities`,
      );
      const names = rows.map((r) => r.legal_name);
      // Only its own office's clients are visible via the generic office branch…
      expect(names).toContain('Acme Manufacturing Pvt Ltd'); // North
      // …never the whole firm.
      expect(names).not.toContain('Coastal Foods Pvt Ltd'); // South
    });

    it('keeps the platform admin firm-wide for identity/HR and audit (unchanged)', async () => {
      const employees = await underContext(adminNorth(), `SELECT id FROM hsdg.employees`);
      expect(employees.length).toBeGreaterThanOrEqual(8);
      const users = await underContext(adminNorth(), `SELECT id FROM hsdg.users`);
      expect(users.length).toBeGreaterThanOrEqual(6);
      const audit = await underContext(adminNorth(), `SELECT id FROM hsdg.audit_events LIMIT 1`);
      expect(audit.length).toBeGreaterThanOrEqual(0); // readable (no permission error)
    });

    it('keeps the Managing Partner business firm-wide (regression guard)', async () => {
      const engagements = await underContext(
        { role: 'managing_partner', officeId: officeIds['NORTH'] },
        `SELECT id FROM hsdg.engagements`,
      );
      expect(engagements.length).toBeGreaterThanOrEqual(2);
    });
  });
});
