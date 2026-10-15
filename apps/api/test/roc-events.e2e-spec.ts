import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { chargeFilingWindow } from '../src/modules/compliance/compliance-events';
import { istToday } from '../src/modules/compliance/compliance-profile';

/**
 * ROC / MCA events (docs/roc-mca-filing-spec.md §6–§8): recording an event
 * creates the forms it triggers and moves the AGM-linked dates; events are
 * corrected or voided with a reason; meetings close as meetings and the AGM's
 * "Record meeting" records the AGM. Events cannot be in the future, so the
 * event-form examples (E13–E15) run on past dates with the same offsets.
 */
describe('ROC events (e2e)', () => {
  let app: INestApplication;
  let pa: string;
  let sy: string;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  // PAN and CIN are unique, so each company takes the next of 10,000 numbers,
  // starting from the clock so a rerun on the same database starts elsewhere.
  let seq = Math.floor(Date.now() / 1000);

  type Item = {
    instanceId: string;
    ruleCode: string;
    label: string;
    dueDate: string;
    workflowStatus: string;
    isProvisional: boolean;
    periodKey?: string;
  };

  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const superuser = async <T>(work: (db: Client) => Promise<T>): Promise<T> => {
    const db = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await db.connect();
    try {
      return await work(db);
    } finally {
      await db.end();
    }
  };

  /** A company with a CIN and a Compliance engagement for FY 2025-26 and 2026-27. */
  const company = async (
    opts: { type?: string; cin?: boolean; directors?: object[] } = {},
  ): Promise<{ eng: string; entity: string; reg: string | null }> => {
    seq += 1;
    const n = String(seq % 10000).padStart(4, '0');
    const type = opts.type ?? 'private_limited';
    const entity = await http()
      .post('/api/v1/entities')
      .set(bearer(pa))
      .send({
        legalName: `ROC Events ${type} ${n}`,
        typeSlug: type,
        officeCode: 'NORTH',
        pan: `AAAC${type === 'partnership' ? 'F' : 'C'}${n}R`.replace('AAACF', 'AAAFF'),
        registrations:
          opts.cin === false
            ? []
            : [{ registrationType: 'cin', registrationNumber: `U74999MH2019PTC${n}01` }],
      })
      .expect(201);
    const entityId = entity.body.id as string;
    let reg: string | null = null;
    if (opts.cin !== false) {
      reg = await superuser(async (db) => {
        const r = await db.query<{ id: string }>(
          `SELECT id FROM hsdg.entity_registrations WHERE entity_id = $1 AND registration_type = 'cin'`,
          [entityId],
        );
        return r.rows[0]!.id;
      });
    }
    const eng = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        kind: 'compliance',
        entityId,
        status: 'accepted',
        financialYear: '2026-27',
        streams: ['roc'],
        years: [{ financialYear: '2025-26' }, { financialYear: '2026-27' }],
      })
      .expect(201);
    // The lead manages the client's compliance profile once the engagement exists.
    if (reg && opts.directors) {
      await http()
        .put(`/api/v1/entities/${entityId}/compliance-profiles`)
        .set(bearer(pa))
        .send({
          scope: 'cin',
          registrationId: reg,
          effectiveFrom: '2025-04-01',
          attributes: { companySubtype: 'private', directors: opts.directors },
        })
        .expect((r) => expect([200, 201]).toContain(r.status));
    }
    return { eng: eng.body.id as string, entity: entityId, reg };
  };

  const items = async (eng: string, fy: string): Promise<Item[]> => {
    const tree = await http()
      .get(`/api/v1/engagements/${eng}/streams/roc/tree?fy=${fy}`)
      .set(bearer(pa))
      .expect(200);
    return [
      ...tree.body.annual,
      ...tree.body.periods.flatMap(
        (p: { periodKey: string; items: Item[]; sections: Record<string, Item[]> }) =>
          [...p.items, ...Object.values(p.sections).flat()].map((i) => ({
            ...i,
            periodKey: p.periodKey,
          })),
      ),
    ];
  };
  const item = async (eng: string, fy: string, rule: string): Promise<Item | undefined> =>
    (await items(eng, fy)).find((i) => i.ruleCode === rule);

  const record = (eng: string, body: object, t = pa) =>
    http().post(`/api/v1/engagements/${eng}/compliance-events`).set(bearer(t)).send(body);

  /** Upload the closing document to the slot of the item's "Lodge" / "Held" line. */
  const uploadDoc = async (inst: string): Promise<string> => {
    const ws = await http().get(`/api/v1/compliance-instances/${inst}`).set(bearer(pa)).expect(200);
    const slot = ws.body.checklist.find((c: { autoTick: string | null }) => c.autoTick === 'lodge')
      .slotCode as string;
    const res = await http()
      .post(`/api/v1/compliance-instances/${inst}/slots/${slot}/documents`)
      .set(bearer(pa))
      .send({ filename: `${slot}.pdf`, contentType: 'application/pdf', contentBase64: b64(slot) })
      .expect(201);
    return res.body.slots.find((s: { slotCode: string }) => s.slotCode === slot).documents[0].id;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('the AGM moves the AGM-linked forms', () => {
    it('E1 — nothing recorded: AOC-4 30 Oct, MGT-7 29 Nov (provisional), no ADT-1', async () => {
      const { eng } = await company();
      expect(await item(eng, '2025-26', 'ROC_AOC4')).toMatchObject({
        dueDate: '2026-10-30',
        isProvisional: true,
      });
      expect((await item(eng, '2025-26', 'ROC_MGT7'))?.dueDate).toBe('2026-11-29');
      expect(await item(eng, '2025-26', 'ROC_ADT1')).toBeUndefined();
    });

    it('E2 — AGM held 30 Sep with the auditor appointed: ADT-1 due 15 Oct; dates stand, now firm', async () => {
      const { eng } = await company();
      const res = await record(eng, {
        eventType: 'agm',
        eventDate: '2026-09-30',
        details: { auditorAppointed: true },
      }).expect(201);
      expect(res.body.event).toMatchObject({
        eventType: 'agm',
        financialYear: '2025-26',
        details: { auditorAppointed: true },
      });
      expect(res.body.changes.created.map((c: { label: string }) => c.label).join()).toMatch(
        /ADT-1/,
      );
      expect((await item(eng, '2025-26', 'ROC_ADT1'))?.dueDate).toBe('2026-10-15');
      expect(await item(eng, '2025-26', 'ROC_AOC4')).toMatchObject({
        dueDate: '2026-10-30',
        isProvisional: false,
      });
      // Recorded twice → 409: correct it instead.
      await record(eng, { eventType: 'agm', eventDate: '2026-09-29' }).expect(409);
    });

    it('E3 + E18 — AGM 25 Sep moves AOC-4 / MGT-7; correcting to 28 Sep moves the unstarted, flags the started', async () => {
      const { eng } = await company();
      const res = await record(eng, { eventType: 'agm', eventDate: '2026-09-25' }).expect(201);
      expect(res.body.changes.moved.length).toBeGreaterThanOrEqual(2);
      const aoc4 = (await item(eng, '2025-26', 'ROC_AOC4'))!;
      expect(aoc4.dueDate).toBe('2026-10-25');
      expect((await item(eng, '2025-26', 'ROC_MGT7'))?.dueDate).toBe('2026-11-24');
      expect(await item(eng, '2025-26', 'ROC_ADT1')).toBeUndefined();

      // AOC-4 goes into preparation.
      await superuser((db) =>
        db.query(
          `UPDATE hsdg.compliance_instances SET workflow_status = 'in_preparation', status = 'in_progress' WHERE id = $1`,
          [aoc4.instanceId],
        ),
      );
      const ev = res.body.event.id as string;
      // A reason is required.
      await http()
        .patch(`/api/v1/engagements/${eng}/compliance-events/${ev}`)
        .set(bearer(pa))
        .send({ eventDate: '2026-09-28' })
        .expect(400);
      // Only the lead corrects.
      await http()
        .patch(`/api/v1/engagements/${eng}/compliance-events/${ev}`)
        .set(bearer(sy))
        .send({ eventDate: '2026-09-28', reason: 'Wrong date' })
        .expect((r) => expect([403, 404]).toContain(r.status));
      const fixed = await http()
        .patch(`/api/v1/engagements/${eng}/compliance-events/${ev}`)
        .set(bearer(pa))
        .send({ eventDate: '2026-09-28', reason: 'The AGM was on the 28th' })
        .expect(200);
      expect(fixed.body.event.eventDate).toBe('2026-09-28');
      expect(fixed.body.changes.moved).toEqual(
        expect.arrayContaining([expect.objectContaining({ from: '2026-11-24', to: '2026-11-27' })]),
      );
      expect(fixed.body.changes.flagged.length).toBeGreaterThanOrEqual(1);
      expect((await item(eng, '2025-26', 'ROC_MGT7'))?.dueDate).toBe('2026-11-27');
      expect((await item(eng, '2025-26', 'ROC_AOC4'))?.dueDate).toBe('2026-10-25');
      const flagged = await superuser((db) =>
        db.query<{ profile_changed_at: Date | null }>(
          `SELECT profile_changed_at FROM hsdg.compliance_instances WHERE id = $1`,
          [aoc4.instanceId],
        ),
      );
      expect(flagged.rows[0]!.profile_changed_at).not.toBeNull();

      // The history keeps both, with the reason; Activity shows them.
      const log = await superuser((db) =>
        db.query<{ action: string; reason: string | null }>(
          `SELECT action, reason FROM hsdg.compliance_event_log WHERE event_id = $1 ORDER BY created_at`,
          [ev],
        ),
      );
      expect(log.rows).toEqual([
        { action: 'recorded', reason: null },
        { action: 'corrected', reason: 'The AGM was on the 28th' },
      ]);
      const activity = await http()
        .get(`/api/v1/engagements/${eng}/activity?kind=event_recorded,event_corrected`)
        .set(bearer(pa))
        .expect(200);
      expect(activity.body.items.map((a: { kind: string }) => a.kind).sort()).toEqual([
        'event_corrected',
        'event_recorded',
      ]);
    });

    it('P2-2 — a 3-month AGM extension moves the AGM and the provisional AOC-4 date', async () => {
      const { eng } = await company();
      expect((await item(eng, '2025-26', 'ROC_AGM'))?.dueDate).toBe('2026-09-30');
      await record(eng, {
        eventType: 'agm_extension',
        eventDate: '2026-09-01',
        details: {},
      }).expect(400);
      await record(eng, {
        eventType: 'agm_extension',
        eventDate: '2026-09-01',
        details: { months: 3, approvalRef: 'GNL-1/2026' },
      }).expect(201);
      // 30 Sep + 3 months = 30 Dec; AOC-4 runs 30 days from the extended date.
      expect((await item(eng, '2025-26', 'ROC_AGM'))?.dueDate).toBe('2026-12-30');
      expect((await item(eng, '2025-26', 'ROC_AOC4'))?.dueDate).toBe('2027-01-29');
    });
  });

  describe('event forms', () => {
    it('E13 — a director appointed: DIR-12 in 30 days, the directors list updated; voiding undoes both', async () => {
      const asha = { din: '11111111', name: 'Asha', kycCycleStartFy: '2024-25' };
      const { eng, entity, reg } = await company({ directors: [asha] });
      await record(eng, {
        eventType: 'director_change',
        eventDate: '2026-09-05',
        details: { din: '22222222', change: 'appointed' },
      }).expect(400); // the name is needed for the directors list
      const res = await record(eng, {
        eventType: 'director_change',
        eventDate: '2026-09-05',
        details: { din: '22222222', name: 'Ravi', change: 'appointed' },
      }).expect(201);
      expect(res.body.created).toBe(1);
      const dir12 = (await items(eng, '2026-27')).find((i) => i.ruleCode === 'ROC_DIR12')!;
      expect(dir12.dueDate).toBe('2026-10-05');

      // The appointment's checklist: DIR-2 / DIR-8, not the resignation letter.
      const ws = await http()
        .get(`/api/v1/compliance-instances/${dir12.instanceId}`)
        .set(bearer(pa))
        .expect(200);
      const codes = ws.body.checklist.map((c: { itemCode: string }) => c.itemCode);
      expect(codes).toEqual(expect.arrayContaining(['CONSENT', 'RESOLUTION', 'DSC', 'LODGE']));
      expect(codes).not.toContain('RESIGNATION');

      const profiles = async () =>
        (
          await http()
            .get(`/api/v1/entities/${entity}/compliance-profiles`)
            .set(bearer(pa))
            .expect(200)
        ).body;
      const cinRows = (p: {
        profiles: Array<{
          scope: string;
          registrationId: string;
          effectiveFrom: string;
          attributes: { directors?: Array<{ din: string }> };
        }>;
      }) => p.profiles.filter((r) => r.scope === 'cin' && r.registrationId === reg);
      const after = cinRows(await profiles());
      const current = after.find((r) => r.effectiveFrom === '2026-09-05')!;
      expect(current.attributes.directors!.map((d) => d.din)).toEqual(['11111111', '22222222']);
      expect(
        after
          .find((r) => r.effectiveFrom === '2025-04-01')!
          .attributes.directors!.map((d) => d.din),
      ).toEqual(['11111111']);

      // Void: the unstarted DIR-12 no longer applies; the director is removed again.
      const voided = await http()
        .delete(`/api/v1/engagements/${eng}/compliance-events/${res.body.event.id}`)
        .set(bearer(pa))
        .send({ reason: 'Recorded on the wrong company' })
        .expect(200);
      expect(voided.body.event.voidedAt).not.toBeNull();
      expect(voided.body.changes.notApplicable.length).toBe(1);
      const gone = (await items(eng, '2026-27')).find((i) => i.ruleCode === 'ROC_DIR12');
      expect(gone?.workflowStatus ?? 'not_applicable').toBe('not_applicable');
      const back = cinRows(await profiles()).find((r) => r.effectiveFrom === '2026-09-05')!;
      expect(back.attributes.directors!.map((d) => d.din)).toEqual(['11111111']);
      // A voided event is not voided twice, nor corrected.
      await http()
        .delete(`/api/v1/engagements/${eng}/compliance-events/${res.body.event.id}`)
        .set(bearer(pa))
        .send({ reason: 'again' })
        .expect(400);
    });

    it('E14 — an allotment: PAS-3 in 30 days, 15 for a private placement (with PAS-4 / PAS-5)', async () => {
      const { eng } = await company();
      await record(eng, {
        eventType: 'allotment',
        eventDate: '2026-09-10',
        details: { privatePlacement: false },
      }).expect(201);
      expect((await item(eng, '2026-27', 'ROC_PAS3'))?.dueDate).toBe('2026-10-10');

      const other = await company();
      await record(other.eng, {
        eventType: 'allotment',
        eventDate: '2026-09-10',
        details: { privatePlacement: true },
      }).expect(201);
      const pas3 = (await item(other.eng, '2026-27', 'ROC_PAS3'))!;
      expect(pas3.dueDate).toBe('2026-09-25');
      const ws = await http()
        .get(`/api/v1/compliance-instances/${pas3.instanceId}`)
        .set(bearer(pa))
        .expect(200);
      expect(ws.body.checklist.map((c: { itemCode: string }) => c.itemCode)).toContain('PAS4_PAS5');
    });

    it('E15 + P2-3 — a charge: CHG-1 in 30 days, then the additional-fee window to day 90', async () => {
      const { eng } = await company();
      await record(eng, {
        eventType: 'charge_creation',
        eventDate: '2026-08-01',
        details: { chargeHolder: 'State Bank of India', amount: 5_000_000 },
      }).expect(201);
      const chg1 = (await item(eng, '2026-27', 'ROC_CHG1'))!;
      expect(chg1.dueDate).toBe('2026-08-31');
      const ws = await http()
        .get(`/api/v1/compliance-instances/${chg1.instanceId}`)
        .set(bearer(pa))
        .expect(200);
      expect(ws.body.instance.chargeWindow).toEqual(chargeFilingWindow('2026-08-01', istToday()));
    });

    it('§6.1 — the FY defaults per event and can be picked on the form', async () => {
      const { eng } = await company();
      const auto = await record(eng, { eventType: 'allotment', eventDate: '2026-05-04' }).expect(
        201,
      );
      expect(auto.body.event.financialYear).toBe('2026-27');
      const picked = await record(eng, {
        eventType: 'allotment',
        eventDate: '2026-04-02',
        financialYear: '2025-26',
      }).expect(201);
      expect(picked.body.event.financialYear).toBe('2025-26');
      await record(eng, {
        eventType: 'allotment',
        eventDate: '2026-04-03',
        financialYear: '2025-2026',
      }).expect(400);
    });

    it('rejects a future date, bad details and a non-lead', async () => {
      const { eng } = await company();
      await record(eng, { eventType: 'allotment', eventDate: '2099-01-01' }).expect(400);
      await record(eng, {
        eventType: 'director_change',
        eventDate: '2026-09-01',
        details: { din: '123', change: 'appointed', name: 'X' },
      }).expect(400);
      await record(eng, { eventType: 'allotment', eventDate: '2026-09-01' }, sy).expect((r) =>
        expect([403, 404]).toContain(r.status),
      );
    });
  });

  describe('meetings close as meetings', () => {
    it('E7 — a board meeting held 15 May records against Apr–Jun: Held, no SRN', async () => {
      const { eng } = await company();
      const bm = (await items(eng, '2026-27')).find(
        (i) => i.ruleCode === 'ROC_BOARD_MEETING' && i.periodKey?.endsWith('Q1'),
      )!;
      expect(bm).toBeDefined();
      const minutes = await uploadDoc(bm.instanceId);
      // Before the period starts → 400.
      await http()
        .post(`/api/v1/compliance-instances/${bm.instanceId}/lodge`)
        .set(bearer(pa))
        .send({ filedOn: '2026-03-31', ackDocumentId: minutes })
        .expect(400);
      const res = await http()
        .post(`/api/v1/compliance-instances/${bm.instanceId}/lodge`)
        .set(bearer(pa))
        .send({ filedOn: '2026-05-15', ackDocumentId: minutes })
        .expect(201);
      expect(res.body.filing).toMatchObject({
        referenceKind: 'internal',
        referenceNo: 'MTG-2026-05-15',
        filedOn: '2026-05-15',
      });
      expect(res.body.instance.workflowStatus).toBe('filed');

      // P2-6: the next board meeting is due within 120 days of it.
      const ov = await http()
        .get(`/api/v1/engagements/${eng}/roc-overview`)
        .set(bearer(pa))
        .expect(200);
      expect(ov.body.message).toBeNull();
      expect(ov.body.boardMeetings[0]).toMatchObject({
        lastHeldOn: '2026-05-15',
        dueBy: '2026-09-12',
        rule: 'every_120_days',
      });
    });

    it('§5.4 — MGT-7’s Meetings line fills from the FY’s board meetings', async () => {
      const { eng, reg } = await company();
      const all = await items(eng, '2025-26');
      const mgt7 = all.find((i) => i.ruleCode === 'ROC_MGT7')!;
      const bms = all.filter((i) => i.ruleCode === 'ROC_BOARD_MEETING');
      expect(mgt7).toBeDefined();
      expect(bms.length).toBe(4);
      const line = async () => {
        const ws = await http()
          .get(`/api/v1/compliance-instances/${mgt7.instanceId}`)
          .set(bearer(pa))
          .expect(200);
        return ws.body.checklist.find((c: { itemCode: string }) => c.itemCode === 'MEETINGS');
      };
      // Read straight from the table: a board meeting's record re-ticks MGT-7 itself.
      const statusInDb = () =>
        superuser(async (db) => {
          const r = await db.query<{ status: string }>(
            `SELECT status FROM hsdg.instance_checklist_items
              WHERE compliance_instance_id = $1 AND item_code = 'MEETINGS'`,
            [mgt7.instanceId],
          );
          return r.rows[0]!.status;
        });
      expect(await line()).toMatchObject({
        autoTick: 'meetings',
        status: 'open',
        boardMeetings: { financialYear: '2025-26', heldOn: [], total: 4 },
      });

      const heldOn: Record<string, string> = {
        Q1: '2025-05-15',
        Q2: '2025-08-14',
        Q3: '2025-11-13',
        Q4: '2026-02-12',
      };
      const ids: Record<string, string> = {};
      for (const bm of bms) {
        const q = bm.periodKey!.slice(-2);
        ids[q] = bm.instanceId;
        const minutes = await uploadDoc(bm.instanceId);
        await http()
          .post(`/api/v1/compliance-instances/${bm.instanceId}/lodge`)
          .set(bearer(pa))
          .send({ filedOn: heldOn[q], ackDocumentId: minutes })
          .expect(201);
        if (q !== 'Q4') expect(await statusInDb()).toBe('open');
      }
      expect(Object.keys(ids).sort()).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
      // All four held → ticked by the last record, before anyone opens MGT-7.
      expect(await statusInDb()).toBe('done');
      expect(await line()).toMatchObject({
        status: 'done',
        doneByName: null,
        boardMeetings: { heldOn: Object.values(heldOn).sort(), total: 4 },
      });

      // Undoing a meeting re-opens it …
      await http()
        .post(`/api/v1/compliance-instances/${ids.Q4}/lodge/undo`)
        .set(bearer(pa))
        .send({ reason: 'Wrong date' })
        .expect(201);
      expect(await statusInDb()).toBe('open');
      const open = await line();
      expect(open.boardMeetings.heldOn).toHaveLength(3);

      // … and a hand tick (committee meetings count too) stands without it.
      const ticked = await http()
        .patch(`/api/v1/compliance-instances/${mgt7.instanceId}/items/${open.id}`)
        .set(bearer(pa))
        .send({ status: 'done', version: open.version })
        .expect(200);
      expect(
        ticked.body.checklist.find((c: { itemCode: string }) => c.itemCode === 'MEETINGS').status,
      ).toBe('done');
      expect((await line()).status).toBe('done');
      expect(reg).not.toBeNull();
    });

    it('E17 — recording the AGM meeting records the AGM; undoing it voids the event', async () => {
      const { eng } = await company();
      const agm = (await item(eng, '2025-26', 'ROC_AGM'))!;
      const minutes = await uploadDoc(agm.instanceId);
      const res = await http()
        .post(`/api/v1/compliance-instances/${agm.instanceId}/lodge`)
        .set(bearer(pa))
        .send({ filedOn: '2026-09-30', ackDocumentId: minutes, auditorAppointed: true })
        .expect(201);
      expect(res.body.filing.referenceKind).toBe('internal');

      const events = await http()
        .get(`/api/v1/engagements/${eng}/compliance-events`)
        .set(bearer(pa))
        .expect(200);
      expect(events.body).toHaveLength(1);
      expect(events.body[0]).toMatchObject({
        eventType: 'agm',
        eventDate: '2026-09-30',
        financialYear: '2025-26',
        sourceInstanceId: agm.instanceId,
        details: { auditorAppointed: true },
      });
      // The meeting and the event go together: neither voided nor re-dated on its own.
      const evId = events.body[0].id as string;
      const lone = await http()
        .delete(`/api/v1/engagements/${eng}/compliance-events/${evId}`)
        .set(bearer(pa))
        .send({ reason: 'Try it alone' })
        .expect(400);
      expect(lone.body.message).toMatch(/undo the meeting record/);
      await http()
        .patch(`/api/v1/engagements/${eng}/compliance-events/${evId}`)
        .set(bearer(pa))
        .send({ eventDate: '2026-09-29', reason: 'Wrong date' })
        .expect(400);
      expect((await item(eng, '2025-26', 'ROC_ADT1'))?.dueDate).toBe('2026-10-15');

      // AOC-4's "AGM held" line ticks itself.
      const aoc4 = (await item(eng, '2025-26', 'ROC_AOC4'))!;
      const ws = await http()
        .get(`/api/v1/compliance-instances/${aoc4.instanceId}`)
        .set(bearer(pa))
        .expect(200);
      expect(
        ws.body.checklist.find((c: { itemCode: string }) => c.itemCode === 'AGM_HELD')?.status,
      ).toBe('done');

      // Undo the meeting record: the AGM event goes with it, the line un-ticks.
      await http()
        .post(`/api/v1/compliance-instances/${agm.instanceId}/lodge/undo`)
        .set(bearer(pa))
        .send({ reason: 'Wrong item' })
        .expect(201);
      const after = await http()
        .get(`/api/v1/engagements/${eng}/compliance-events`)
        .set(bearer(pa))
        .expect(200);
      expect(after.body[0].voidedAt).not.toBeNull();
      const ws2 = await http()
        .get(`/api/v1/compliance-instances/${aoc4.instanceId}`)
        .set(bearer(pa))
        .expect(200);
      expect(
        ws2.body.checklist.find((c: { itemCode: string }) => c.itemCode === 'AGM_HELD')?.status,
      ).toBe('open');
    });

    it('only the lead records the AGM meeting', async () => {
      const { eng } = await company();
      const agm = (await item(eng, '2025-26', 'ROC_AGM'))!;
      const emp = await superuser((db) =>
        db.query<{ id: string }>(`SELECT id FROM hsdg.employees WHERE employee_code = 'EMP006'`),
      );
      await http()
        .post(`/api/v1/engagements/${eng}/team`)
        .set(bearer(pa))
        .send({ employeeId: emp.rows[0]!.id, roleOnEngagement: 'member' })
        .expect(201);
      await http()
        .post(`/api/v1/compliance-instances/${agm.instanceId}/lodge`)
        .set(bearer(sy))
        .send({ filedOn: '2026-09-30', ackDocumentId: agm.instanceId })
        .expect(403);
    });
  });

  describe('the ROC tab when there is nothing to file (G13)', () => {
    it('asks for the CIN on a company without one', async () => {
      const { eng } = await company({ cin: false });
      const ov = await http()
        .get(`/api/v1/engagements/${eng}/roc-overview`)
        .set(bearer(pa))
        .expect(200);
      expect(ov.body).toMatchObject({ registrations: [], boardMeetings: [] });
      expect(ov.body.message).toMatch(/Add the CIN/);
      await record(eng, { eventType: 'allotment', eventDate: '2026-09-01' }).expect(400);
    });
  });
});
