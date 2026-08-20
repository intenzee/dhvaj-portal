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

  // Phase 6: lifecycle/workflow transition config + history, proven at the
  // database layer independently of the API/NestJS guards.
  describe('engagement lifecycle & workflow (Phase 6)', () => {
    const emp = async (code: string): Promise<string> => {
      const rows = await underContext<{ id: string }>(
        { role: 'managing_partner' },
        `SELECT id FROM hsdg.employees WHERE employee_code = '${code}'`,
      );
      return rows[0]!.id;
    };
    const acmeEngagementId = async (): Promise<string> => {
      const rows = await underContext<{ id: string }>(
        { role: 'managing_partner' },
        `SELECT id FROM hsdg.engagements WHERE engagement_code = 'ENG00001'`,
      );
      return rows[0]!.id;
    };

    it.each(['article', 'senior'])(
      '"%s" holds no engagement.manage permission — no lifecycle governance authority (§25 tests 18-19)',
      async (roleSlug) => {
        const rows = await underContext<{ slug: string }>(
          { role: 'managing_partner' },
          `SELECT p.slug FROM hsdg.role_permissions rp
           JOIN hsdg.roles r ON r.id = rp.role_id
           JOIN hsdg.permissions p ON p.id = rp.permission_id
           WHERE r.slug = '${roleSlug}' AND p.slug = 'engagement.manage'`,
        );
        expect(rows).toHaveLength(0);
      },
    );

    it('is fail-closed: no context ⇒ zero lifecycle transitions and zero workflow transitions visible', async () => {
      const transitions = await underContext(
        {},
        'SELECT id FROM hsdg.engagement_lifecycle_transitions',
      );
      expect(transitions).toHaveLength(0);
      const workflow = await underContext({}, 'SELECT id FROM hsdg.workflow_transitions');
      expect(workflow).toHaveLength(0);
    });

    it('lifecycle transitions and workflow transitions are firm-wide config: any authenticated role reads them', async () => {
      const rows = await underContext(
        { userId: userIds['senior.y@hsdg.in'], role: 'senior', officeId: officeIds['SOUTH'] },
        'SELECT action FROM hsdg.engagement_lifecycle_transitions',
      );
      expect(rows.length).toBeGreaterThanOrEqual(14);
      const wf = await underContext(
        { userId: userIds['senior.y@hsdg.in'], role: 'senior', officeId: officeIds['SOUTH'] },
        'SELECT id FROM hsdg.workflow_transitions',
      );
      expect(wf.length).toBeGreaterThanOrEqual(1);
    });

    it('forbids the app role from writing lifecycle/workflow transition config (reference data)', async () => {
      await expect(
        app.query(
          `INSERT INTO hsdg.engagement_lifecycle_transitions (action, from_status, to_status, display_name)
           VALUES ('x', 'prospect', 'cancelled', 'X')`,
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        app.query(`UPDATE hsdg.workflow_transitions SET display_name = 'tampered' WHERE true`),
      ).rejects.toThrow(/permission denied/i);
    });

    it('makes engagement_lifecycle_history immutable to the app role (UPDATE/DELETE denied)', async () => {
      await expect(
        app.query(`UPDATE hsdg.engagement_lifecycle_history SET reason = 'tamper'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(app.query(`DELETE FROM hsdg.engagement_lifecycle_history`)).rejects.toThrow(
        /permission denied/i,
      );
    });

    it('is fail-closed: no context ⇒ zero lifecycle-history rows visible, even if some exist', async () => {
      const rows = await underContext({}, 'SELECT id FROM hsdg.engagement_lifecycle_history');
      expect(rows).toHaveLength(0);
    });

    it('denies an unassigned partner the workflow state and lifecycle history of an engagement they are not on', async () => {
      const partnerB = await emp('EMP004'); // not on Acme (ENG00001)
      const acmeId = await acmeEngagementId();
      const rows = await underEmpFor(
        'partner',
        'SOUTH',
        partnerB,
        `SELECT current_workflow_state_id FROM hsdg.engagements WHERE id = '${acmeId}'`,
      );
      expect(rows).toHaveLength(0); // the row itself is invisible, not just the column
      const history = await underEmpFor(
        'partner',
        'SOUTH',
        partnerB,
        `SELECT id FROM hsdg.engagement_lifecycle_history WHERE engagement_id = '${acmeId}'`,
      );
      expect(history).toHaveLength(0);
    });

    it('lets an assigned team member see the engagement workflow-state and lifecycle history columns/rows', async () => {
      // Senior Y (SOUTH) is on Acme's (NORTH) team — shared resource, ADR-0008.
      const seniorY = await emp('EMP006');
      const acmeId = await acmeEngagementId();
      const rows = await underEmpFor(
        'senior',
        'SOUTH',
        seniorY,
        `SELECT id, current_workflow_state_id FROM hsdg.engagements WHERE id = '${acmeId}'`,
      );
      expect(rows).toHaveLength(1);
    });

    it('records before/after status on the audit event for a lifecycle transition (direct column check)', async () => {
      // Insert directly (mirrors what EngagementLifecycleService/AuditService
      // do inside the same transaction as the mutation) then inspect
      // audit_events' jsonb columns — the API's GET /audit never exposes them.
      // Runs firm-wide throughout so the INSERT's own transaction can also
      // SELECT it back (audit read is firm-wide-only; §26 direct-DB test).
      const acmeId = await acmeEngagementId();
      await app.query('BEGIN');
      try {
        await app.query('SELECT set_config($1,$2,true)', ['hsdg.user_id', userIds['mp@hsdg.in']]);
        await app.query('SELECT set_config($1,$2,true)', ['hsdg.role', 'managing_partner']);
        await app.query('SELECT set_config($1,$2,true)', ['hsdg.office_id', officeIds['NORTH']]);
        await app.query(
          `INSERT INTO hsdg.audit_events (actor_user_id, actor_role, action, object_type, object_id, before_state, after_state)
           VALUES ($1, 'partner', 'engagement.status_changed', 'engagement', $2, $3::jsonb, $4::jsonb)`,
          [
            userIds['partner.a@hsdg.in'],
            acmeId,
            JSON.stringify({ status: 'accepted', version: 1 }),
            JSON.stringify({ status: 'active', version: 2 }),
          ],
        );
        const { rows } = await app.query<{
          before_state: { status: string };
          after_state: { status: string };
        }>(
          `SELECT before_state, after_state FROM hsdg.audit_events
           WHERE object_id = $1 AND action = 'engagement.status_changed'
           ORDER BY occurred_at DESC LIMIT 1`,
          [acmeId],
        );
        expect(rows[0]!.before_state.status).toBe('accepted');
        expect(rows[0]!.after_state.status).toBe('active');
      } finally {
        await app.query('ROLLBACK');
      }
    });

    /** Assignment-based context read, mirroring `underEmp` in the engagements block above. */
    async function underEmpFor<T>(
      role: string,
      officeCode: 'NORTH' | 'SOUTH',
      employeeId: string,
      sql: string,
    ): Promise<T[]> {
      return underContext<T>({ role, officeId: officeIds[officeCode], employeeId }, sql);
    }
  });

  // Phase 7: review & sign-off engine, proven at the database layer independently
  // of the API. Reviews/points are engagement-scoped professional evidence;
  // review models drive the completion gate; the review plan is escalate-only.
  describe('review engine (Phase 7)', () => {
    const emp = async (code: string): Promise<string> => {
      const rows = await underContext<{ id: string }>(
        { role: 'managing_partner' },
        `SELECT id FROM hsdg.employees WHERE employee_code = '${code}'`,
      );
      return rows[0]!.id;
    };
    const engId = async (code: string): Promise<string> => {
      const rows = await underContext<{ id: string }>(
        { role: 'managing_partner' },
        `SELECT id FROM hsdg.engagements WHERE engagement_code = '${code}'`,
      );
      return rows[0]!.id;
    };
    const reviewModelId = async (slug: string): Promise<string> => {
      const rows = await underContext<{ id: string }>(
        { role: 'managing_partner' },
        `SELECT id FROM hsdg.review_models WHERE slug = '${slug}'`,
      );
      return rows[0]!.id;
    };

    it('is fail-closed: no context ⇒ zero reviews and zero review points', async () => {
      expect(await underContext({}, 'SELECT id FROM hsdg.engagement_reviews')).toHaveLength(0);
      expect(await underContext({}, 'SELECT id FROM hsdg.engagement_review_points')).toHaveLength(
        0,
      );
    });

    it('review models expose requires_ep_signoff and are read-only to the app role', async () => {
      const rows = await underContext<{ slug: string; requires_ep_signoff: boolean }>(
        { userId: userIds['senior.y@hsdg.in'], role: 'senior', officeId: officeIds['SOUTH'] },
        `SELECT slug, requires_ep_signoff FROM hsdg.review_models ORDER BY rank`,
      );
      const byslug = Object.fromEntries(rows.map((r) => [r.slug, r.requires_ep_signoff]));
      expect(byslug['manager_review']).toBe(false);
      expect(byslug['full_ep_review']).toBe(true);
      await expect(
        app.query(
          `INSERT INTO hsdg.review_models (slug, name, rank, requires_ep_signoff) VALUES ('z','Z',88,true)`,
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('scopes reviews to engagement membership (unassigned partner blind; team member sees)', async () => {
      const acmeId = await engId('ENG00001'); // Acme audit, North
      const mpEmp = await emp('EMP001');
      const partnerB = await emp('EMP004'); // unassigned to Acme
      const seniorY = await emp('EMP006'); // on Acme's team (South resource)

      await app.query('BEGIN');
      try {
        const setCtx = (
          userId: string | undefined,
          role: string,
          officeCode: 'NORTH' | 'SOUTH',
          empId: string,
        ) =>
          app.query(
            'SELECT set_config($1,$2,true),set_config($3,$4,true),set_config($5,$6,true),set_config($7,$8,true)',
            [
              'hsdg.user_id',
              userId ?? '',
              'hsdg.role',
              role,
              'hsdg.office_id',
              officeIds[officeCode] ?? '',
              'hsdg.employee_id',
              empId,
            ],
          );

        // MP (firm-wide lead) records a review on the Acme engagement.
        await setCtx(userIds['mp@hsdg.in'], 'managing_partner', 'NORTH', mpEmp);
        await app.query(
          `INSERT INTO hsdg.engagement_reviews
             (engagement_id, review_type, reviewer_employee_id, reviewer_role, outcome)
           VALUES ($1, 'manager_review', $2, 'managing_partner', 'cleared')`,
          [acmeId, mpEmp],
        );

        // Unassigned Partner B (South) cannot see it.
        await setCtx(userIds['partner.b@hsdg.in'], 'partner', 'SOUTH', partnerB);
        const asB = await app.query(
          `SELECT id FROM hsdg.engagement_reviews WHERE engagement_id = '${acmeId}'`,
        );
        expect(asB.rows).toHaveLength(0);

        // Senior Y — on Acme's team — can.
        await setCtx(userIds['senior.y@hsdg.in'], 'senior', 'SOUTH', seniorY);
        const asY = await app.query(
          `SELECT id FROM hsdg.engagement_reviews WHERE engagement_id = '${acmeId}'`,
        );
        expect(asY.rows.length).toBeGreaterThanOrEqual(1);
      } finally {
        await app.query('ROLLBACK');
      }
    });

    it('forbids the app role from DELETEing review evidence (reviews & points)', async () => {
      await expect(app.query(`DELETE FROM hsdg.engagement_reviews`)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(app.query(`DELETE FROM hsdg.engagement_review_points`)).rejects.toThrow(
        /permission denied/i,
      );
    });

    it('enforces escalate-only review plans at the database layer (weakening rejected)', async () => {
      const acmeId = await engId('ENG00001'); // STAT_AUDIT ⇒ requires full_ep_review
      const managerReview = await reviewModelId('manager_review'); // weaker (rank 10)
      await app.query('BEGIN');
      try {
        await app.query('SELECT set_config($1,$2,true)', ['hsdg.role', 'managing_partner']);
        await app.query('SELECT set_config($1,$2,true)', ['hsdg.office_id', officeIds['NORTH']]);
        await app.query('SELECT set_config($1,$2,true)', ['hsdg.user_id', userIds['mp@hsdg.in']]);
        await expect(
          app.query(
            `UPDATE hsdg.engagements SET review_model_id = '${managerReview}' WHERE id = '${acmeId}'`,
          ),
        ).rejects.toThrow(/weaker/i);
      } finally {
        await app.query('ROLLBACK');
      }
    });
  });

  // Phase 8: compliance engine, proven at the database layer. Rules/versions/
  // holidays are firm-wide config; instances/overrides are engagement-scoped.
  describe('compliance engine (Phase 8)', () => {
    const emp = async (code: string): Promise<string> => {
      const rows = await underContext<{ id: string }>(
        { role: 'managing_partner' },
        `SELECT id FROM hsdg.employees WHERE employee_code = '${code}'`,
      );
      return rows[0]!.id;
    };
    const engId = async (code: string): Promise<string> => {
      const rows = await underContext<{ id: string }>(
        { role: 'managing_partner' },
        `SELECT id FROM hsdg.engagements WHERE engagement_code = '${code}'`,
      );
      return rows[0]!.id;
    };
    const setCtx = (
      userId: string | undefined,
      role: string,
      officeCode: 'NORTH' | 'SOUTH',
      empId: string,
    ) =>
      app.query(
        'SELECT set_config($1,$2,true),set_config($3,$4,true),set_config($5,$6,true),set_config($7,$8,true)',
        [
          'hsdg.user_id',
          userId ?? '',
          'hsdg.role',
          role,
          'hsdg.office_id',
          officeIds[officeCode] ?? '',
          'hsdg.employee_id',
          empId,
        ],
      );

    it('is fail-closed: no context ⇒ zero rules, versions, and instances', async () => {
      expect(await underContext({}, 'SELECT id FROM hsdg.compliance_rules')).toHaveLength(0);
      expect(await underContext({}, 'SELECT id FROM hsdg.compliance_rule_versions')).toHaveLength(
        0,
      );
      expect(await underContext({}, 'SELECT id FROM hsdg.compliance_instances')).toHaveLength(0);
    });

    it('rules are firm-wide config: any role reads, only firm-wide writes', async () => {
      // Resolve employee ids BEFORE opening the transaction — emp() runs its own
      // BEGIN/ROLLBACK, which would otherwise abort the transaction below.
      const mpEmp = await emp('EMP001');
      const seniorEmp = await emp('EMP006');
      await app.query('BEGIN');
      try {
        await setCtx(userIds['mp@hsdg.in'], 'managing_partner', 'NORTH', mpEmp);
        const code = `RLS_${Date.now()}`;
        await app.query(`INSERT INTO hsdg.compliance_rules (code, name) VALUES ($1, 'x')`, [code]);

        // A senior (office-scoped) can still read firm-wide config.
        await setCtx(userIds['senior.y@hsdg.in'], 'senior', 'SOUTH', seniorEmp);
        const seen = await app.query(`SELECT id FROM hsdg.compliance_rules WHERE code = $1`, [
          code,
        ]);
        expect(seen.rows).toHaveLength(1);

        // …but a non-firm-wide role cannot WRITE a rule (RLS WITH CHECK).
        await app.query('SELECT set_config($1,$2,true)', ['hsdg.role', 'manager']);
        await expect(
          app.query(
            `INSERT INTO hsdg.compliance_rules (code, name) VALUES ('X_${Date.now()}', 'x')`,
          ),
        ).rejects.toThrow(/row-level security/i);
      } finally {
        await app.query('ROLLBACK');
      }
    });

    it('rule versions and the override log are append-only to the app role', async () => {
      await expect(
        app.query(`UPDATE hsdg.compliance_rule_versions SET offset_days = 0`),
      ).rejects.toThrow(/permission denied/i);
      await expect(app.query(`DELETE FROM hsdg.compliance_rule_versions`)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(app.query(`DELETE FROM hsdg.compliance_instances`)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(app.query(`DELETE FROM hsdg.compliance_instance_overrides`)).rejects.toThrow(
        /permission denied/i,
      );
    });

    it('scopes compliance instances to engagement membership (unassigned blind; member sees)', async () => {
      const acmeId = await engId('ENG00001');
      const mpEmp = await emp('EMP001');
      const partnerB = await emp('EMP004'); // unassigned to Acme
      const seniorY = await emp('EMP006'); // on Acme's team
      await app.query('BEGIN');
      try {
        await setCtx(userIds['mp@hsdg.in'], 'managing_partner', 'NORTH', mpEmp);
        const rule = await app.query<{ id: string }>(
          `INSERT INTO hsdg.compliance_rules (code, name) VALUES ('INST_${Date.now()}', 'x') RETURNING id`,
        );
        const ruleId = rule.rows[0]!.id;
        const ver = await app.query<{ id: string }>(
          `INSERT INTO hsdg.compliance_rule_versions (compliance_rule_id, version, effective_from, calculation_basis)
           VALUES ($1, 1, '2020-04-01', 'fy_end') RETURNING id`,
          [ruleId],
        );
        await app.query(
          `INSERT INTO hsdg.compliance_instances
             (engagement_id, compliance_rule_id, compliance_rule_version_id, reference_date, statutory_deadline, internal_sla_date)
           VALUES ($1, $2, $3, '2027-03-31', '2027-10-31', '2027-10-01')`,
          [acmeId, ruleId, ver.rows[0]!.id],
        );

        await setCtx(userIds['partner.b@hsdg.in'], 'partner', 'SOUTH', partnerB);
        const asB = await app.query(
          `SELECT id FROM hsdg.compliance_instances WHERE engagement_id = '${acmeId}'`,
        );
        expect(asB.rows).toHaveLength(0);

        await setCtx(userIds['senior.y@hsdg.in'], 'senior', 'SOUTH', seniorY);
        const asY = await app.query(
          `SELECT id FROM hsdg.compliance_instances WHERE engagement_id = '${acmeId}'`,
        );
        expect(asY.rows.length).toBeGreaterThanOrEqual(1);
      } finally {
        await app.query('ROLLBACK');
      }
    });
  });

  // Phase 9: tasks & client dependencies, proven at the database layer.
  describe('tasks & client dependencies (Phase 9)', () => {
    const emp = async (code: string): Promise<string> => {
      const rows = await underContext<{ id: string }>(
        { role: 'managing_partner' },
        `SELECT id FROM hsdg.employees WHERE employee_code = '${code}'`,
      );
      return rows[0]!.id;
    };
    const engId = async (code: string): Promise<string> => {
      const rows = await underContext<{ id: string }>(
        { role: 'managing_partner' },
        `SELECT id FROM hsdg.engagements WHERE engagement_code = '${code}'`,
      );
      return rows[0]!.id;
    };
    const setCtx = (
      userId: string | undefined,
      role: string,
      officeCode: 'NORTH' | 'SOUTH',
      empId: string,
    ) =>
      app.query(
        'SELECT set_config($1,$2,true),set_config($3,$4,true),set_config($5,$6,true),set_config($7,$8,true)',
        [
          'hsdg.user_id',
          userId ?? '',
          'hsdg.role',
          role,
          'hsdg.office_id',
          officeIds[officeCode] ?? '',
          'hsdg.employee_id',
          empId,
        ],
      );

    it('is fail-closed: no context ⇒ zero tasks and client dependencies', async () => {
      expect(await underContext({}, 'SELECT id FROM hsdg.tasks')).toHaveLength(0);
      expect(await underContext({}, 'SELECT id FROM hsdg.client_dependencies')).toHaveLength(0);
    });

    it('scopes tasks to membership, and lets the ASSIGNEE (not just a lead) update their task', async () => {
      const acmeId = await engId('ENG00001');
      const mpEmp = await emp('EMP001');
      const partnerB = await emp('EMP004'); // unassigned to Acme
      const seniorY = await emp('EMP006'); // on Acme's team

      await app.query('BEGIN');
      try {
        // MP (firm-wide lead) creates a task assigned to Senior Y.
        await setCtx(userIds['mp@hsdg.in'], 'managing_partner', 'NORTH', mpEmp);
        const task = await app.query<{ id: string }>(
          `INSERT INTO hsdg.tasks (engagement_id, title, assigned_to_employee_id)
           VALUES ($1, 'RLS task', $2) RETURNING id`,
          [acmeId, seniorY],
        );
        const taskId = task.rows[0]!.id;

        // Unassigned Partner B sees nothing.
        await setCtx(userIds['partner.b@hsdg.in'], 'partner', 'SOUTH', partnerB);
        const asB = await app.query(`SELECT id FROM hsdg.tasks WHERE id = '${taskId}'`);
        expect(asB.rows).toHaveLength(0);
        // …and cannot update it (RLS UPDATE: lead or assignee).
        const bUpd = await app.query(
          `UPDATE hsdg.tasks SET status = 'in_progress' WHERE id = '${taskId}'`,
        );
        expect(bUpd.rowCount).toBe(0);

        // Senior Y (the assignee, NOT a lead) sees AND can update it.
        await setCtx(userIds['senior.y@hsdg.in'], 'senior', 'SOUTH', seniorY);
        const asY = await app.query(`SELECT id FROM hsdg.tasks WHERE id = '${taskId}'`);
        expect(asY.rows).toHaveLength(1);
        const yUpd = await app.query(
          `UPDATE hsdg.tasks SET status = 'in_progress' WHERE id = '${taskId}'`,
        );
        expect(yUpd.rowCount).toBe(1);
      } finally {
        await app.query('ROLLBACK');
      }
    });

    it('only engagement-working roles hold task.update (not the platform admin)', async () => {
      const rows = await underContext<{ slug: string }>(
        { role: 'managing_partner' },
        `SELECT r.slug FROM hsdg.role_permissions rp
         JOIN hsdg.roles r ON r.id = rp.role_id
         JOIN hsdg.permissions p ON p.id = rp.permission_id
         WHERE p.slug = 'task.update' ORDER BY r.slug`,
      );
      const slugs = rows.map((r) => r.slug);
      expect(slugs).toEqual(expect.arrayContaining(['senior', 'article', 'manager', 'partner']));
      expect(slugs).not.toContain('admin');
    });
  });

  // Phase 10: documents, proven at the database layer. Metadata + versioned
  // bytes are engagement-scoped; version rows are append-only (immutable
  // professional evidence) — the storage reference lives only behind an
  // RLS-passing read, so there is no URL that bypasses access.
  describe('documents (Phase 10)', () => {
    const emp = async (code: string): Promise<string> => {
      const rows = await underContext<{ id: string }>(
        { role: 'managing_partner' },
        `SELECT id FROM hsdg.employees WHERE employee_code = '${code}'`,
      );
      return rows[0]!.id;
    };
    const engId = async (code: string): Promise<string> => {
      const rows = await underContext<{ id: string }>(
        { role: 'managing_partner' },
        `SELECT id FROM hsdg.engagements WHERE engagement_code = '${code}'`,
      );
      return rows[0]!.id;
    };
    const setCtx = (
      userId: string | undefined,
      role: string,
      officeCode: 'NORTH' | 'SOUTH',
      empId: string,
    ) =>
      app.query(
        'SELECT set_config($1,$2,true),set_config($3,$4,true),set_config($5,$6,true),set_config($7,$8,true)',
        [
          'hsdg.user_id',
          userId ?? '',
          'hsdg.role',
          role,
          'hsdg.office_id',
          officeIds[officeCode] ?? '',
          'hsdg.employee_id',
          empId,
        ],
      );

    it('is fail-closed: no context ⇒ zero documents and zero versions', async () => {
      expect(await underContext({}, 'SELECT id FROM hsdg.documents')).toHaveLength(0);
      expect(await underContext({}, 'SELECT id FROM hsdg.document_versions')).toHaveLength(0);
    });

    it('version rows are append-only to the app role (UPDATE/DELETE denied)', async () => {
      await expect(
        app.query(`UPDATE hsdg.document_versions SET filename = 'tamper'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(app.query(`DELETE FROM hsdg.document_versions`)).rejects.toThrow(
        /permission denied/i,
      );
    });

    it('the app role cannot hard-delete a document (no cascade into the version chain)', async () => {
      await expect(app.query(`DELETE FROM hsdg.documents`)).rejects.toThrow(/permission denied/i);
    });

    it('scopes documents to engagement membership (unassigned blind; member sees the metadata AND the storage reference only via RLS)', async () => {
      const acmeId = await engId('ENG00001');
      const mpEmp = await emp('EMP001');
      const partnerB = await emp('EMP004'); // unassigned to Acme
      const seniorY = await emp('EMP006'); // on Acme's team

      await app.query('BEGIN');
      try {
        // MP (firm-wide lead) creates a document + its first version.
        await setCtx(userIds['mp@hsdg.in'], 'managing_partner', 'NORTH', mpEmp);
        const doc = await app.query<{ id: string }>(
          `INSERT INTO hsdg.documents (engagement_id, title) VALUES ($1, 'RLS doc') RETURNING id`,
          [acmeId],
        );
        const docId = doc.rows[0]!.id;
        await app.query(
          `INSERT INTO hsdg.document_versions
             (document_id, engagement_id, version_no, filename, size_bytes, checksum_sha256, storage_reference)
           VALUES ($1, $2, 1, 'f.txt', 5, repeat('a', 64), 'ref/one')`,
          [docId, acmeId],
        );

        // Unassigned Partner B sees neither the document nor its version/reference.
        await setCtx(userIds['partner.b@hsdg.in'], 'partner', 'SOUTH', partnerB);
        expect(
          (await app.query(`SELECT id FROM hsdg.documents WHERE id = '${docId}'`)).rows,
        ).toHaveLength(0);
        expect(
          (
            await app.query(
              `SELECT storage_reference FROM hsdg.document_versions WHERE document_id = '${docId}'`,
            )
          ).rows,
        ).toHaveLength(0);

        // Senior Y — on Acme's team — sees both.
        await setCtx(userIds['senior.y@hsdg.in'], 'senior', 'SOUTH', seniorY);
        expect(
          (await app.query(`SELECT id FROM hsdg.documents WHERE id = '${docId}'`)).rows,
        ).toHaveLength(1);
        expect(
          (
            await app.query(
              `SELECT storage_reference FROM hsdg.document_versions WHERE document_id = '${docId}'`,
            )
          ).rows,
        ).toHaveLength(1);
      } finally {
        await app.query('ROLLBACK');
      }
    });
  });
});
