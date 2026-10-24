import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import {
  gstinCheckChar,
  type DuplicateClientConflict,
  type DuplicatePair,
  type MergeClientsResult,
  type MergePreview,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { dateFromToday } from './date.helper';

/**
 * One company entered twice — "X Technologies - Firm" with its GSTIN and
 * "X Technologies Private Limited" with its PAN — is found, previewed and
 * merged: the kept client gets the registrations, the engagements (the two
 * Compliance engagements become one) and the billing that follows them; an
 * engagement whose service and year the kept client already has stays; the
 * other client is archived and points to the kept one. Two PANs never merge.
 */
describe('Merging two clients that are one (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;

  const letters = (n: number) =>
    Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join(
      '',
    );
  const digits = (n: number) =>
    String(Math.floor(Math.random() * 9 * 10 ** (n - 1)) + 10 ** (n - 1));
  const pan = (kind: string) => `${letters(3)}${kind}${letters(1)}${digits(4)}${letters(1)}`;
  const gstin = (state: string, p: string) => {
    const first14 = `${state}${p}1Z`;
    return first14 + gstinCheckChar(first14);
  };

  const tag = `Mrg${Date.now().toString(36)}`;
  const PAN = pan('C');
  const GSTIN_DL = gstin('07', PAN);

  const createClient = async (body: Record<string, unknown>) =>
    (
      await http()
        .post('/api/v1/entities')
        .set(bearer(pa))
        .send({ officeCode: 'NORTH', ...body })
        .expect(201)
    ).body as { id: string; entityCode: string };
  const serviceId = async (code: string): Promise<string> => {
    const res = await http().get(`/api/v1/services?search=${code}&limit=100`).set(bearer(mp));
    return (res.body.items as Array<{ id: string; code: string }>).find((s) => s.code === code)!.id;
  };
  const engagement = async (body: Record<string, unknown>) => {
    const res = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({ status: 'accepted', financialYear: '2026-27', ...body });
    if (res.status !== 201)
      throw new Error(`engagement: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { id: string; engagementCode: string };
  };
  const preview = async (keep: string, drop: string): Promise<MergePreview> =>
    (
      await http()
        .get(`/api/v1/entities/${keep}/merge-preview?with=${drop}`)
        .set(bearer(pa))
        .expect(200)
    ).body as MergePreview;

  let keep: { id: string; entityCode: string };
  let drop: { id: string; entityCode: string };
  let keepCompliance: string;
  let dropCompliance: { id: string; engagementCode: string };
  let moved: { id: string; engagementCode: string };
  let clash: { id: string; engagementCode: string };
  let invoiceId: string;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    const settings = await http().get('/api/v1/billing/settings').set(bearer(mp)).expect(200);
    await http()
      .patch('/api/v1/billing/settings')
      .set(bearer(mp))
      .send({ version: settings.body.version, gstin: '07AAAFD1234K1Z5', invoicePrefix: 'INV' })
      .expect(200);

    // The firm's entry, with the GSTIN; then the company, with the PAN.
    drop = await createClient({
      legalName: `${tag} Technologies - Firm`,
      typeSlug: 'partnership',
    });
    keep = await createClient({
      legalName: `${tag} Technologies Private Limited`,
      typeSlug: 'private_limited',
      pan: PAN,
    });

    // Both have an open Compliance engagement; the archived one's has a second year and TDS.
    keepCompliance = (
      await engagement({
        kind: 'compliance',
        entityId: keep.id,
        streams: ['gst'],
        years: [{ financialYear: '2026-27' }],
      })
    ).id;
    dropCompliance = await engagement({
      kind: 'compliance',
      entityId: drop.id,
      streams: ['gst', 'tds'],
      years: [{ financialYear: '2026-27' }, { financialYear: '2027-28' }],
    });
    // Its GSTIN, added once its Compliance engagement is open (a GSTIN on a
    // new client opens one by itself).
    await http()
      .post(`/api/v1/entities/${drop.id}/registrations`)
      .set(bearer(pa))
      .send({ registrationType: 'gstin', registrationNumber: GSTIN_DL, stateCode: '07' })
      .expect(201);
    // An advisory assignment only the archived one has (moves, with its invoice and
    // receipt), and one both have for the same period (stays).
    const advisory = { kind: 'assignment', serviceId: await serviceId('ADVISORY_GEN') };
    moved = await engagement({ ...advisory, entityId: drop.id, periodLabel: `M${tag}` });
    clash = await engagement({ ...advisory, entityId: drop.id, periodLabel: `C${tag}` });
    await engagement({ ...advisory, entityId: keep.id, periodLabel: `C${tag}` });

    const inv = await http()
      .post(`/api/v1/engagements/${moved.id}/invoices`)
      .set(bearer(pa))
      .send({
        clientGstin: GSTIN_DL,
        lines: [{ description: 'GST returns', quantity: '1', unitAmount: '10000.00' }],
      })
      .expect(201);
    invoiceId = inv.body.id as string;
    await http()
      .post(`/api/v1/engagements/${moved.id}/invoices/${invoiceId}/status`)
      .set(bearer(pa))
      .send({ status: 'issued', issueDate: dateFromToday(0) })
      .expect(201);
    await http()
      .post('/api/v1/billing/receipts')
      .set(bearer(pa))
      .send({
        receivedOn: dateFromToday(0),
        mode: 'bank',
        reference: `UTR${tag}`,
        clientEntityId: drop.id,
        netAmount: '11800.00',
      })
      .expect(201);
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('a GSTIN already on another client is a 409 naming it, so the two can be merged', async () => {
    const res = await http()
      .post(`/api/v1/entities/${keep.id}/registrations`)
      .set(bearer(pa))
      .send({ registrationType: 'gstin', registrationNumber: GSTIN_DL, stateCode: '07' })
      .expect(409);
    expect(res.body).toMatchObject<Partial<DuplicateClientConflict>>({
      code: 'duplicate_client',
      entityId: keep.id,
      holder: expect.objectContaining({
        id: drop.id,
        entityCode: drop.entityCode,
        visible: true,
      }) as DuplicateClientConflict['holder'],
      identifier: { type: 'gstin', value: GSTIN_DL },
    });
    expect(res.body.message).toContain(drop.entityCode);
  });

  it('a new client with a PAN already on one is a 409 naming it', async () => {
    const res = await http()
      .post('/api/v1/entities')
      .set(bearer(pa))
      .send({
        legalName: `${tag} Tech Pvt Ltd`,
        typeSlug: 'private_limited',
        officeCode: 'NORTH',
        pan: PAN,
      })
      .expect(409);
    expect(res.body).toMatchObject({
      code: 'duplicate_client',
      entityId: null,
      holder: { id: keep.id, entityCode: keep.entityCode },
    });
  });

  it('lists the pair as likely one client, and the duplicate check says so', async () => {
    const dups = (await http().get('/api/v1/entities/duplicates').set(bearer(pa)).expect(200))
      .body as DuplicatePair[];
    const pair = dups.find(
      (p) => [p.a.id, p.b.id].sort().join() === [keep.id, drop.id].sort().join(),
    );
    expect(pair).toMatchObject({ verdict: 'same' });
    expect(pair!.reasons[0]).toContain(PAN);

    const check = await http()
      .get(
        `/api/v1/entities/duplicate-check?legalName=${encodeURIComponent(`${tag} Technologies`)}`,
      )
      .set(bearer(pa))
      .expect(200);
    expect(check.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: drop.id, verdict: 'probable' }),
        expect.objectContaining({ id: keep.id, verdict: 'probable' }),
      ]),
    );
  });

  it('previews: the same client, keep the one with the PAN, and what each engagement does', async () => {
    const p = await preview(drop.id, keep.id);
    expect(p.verdict).toBe('same');
    expect(p.recommendedKeepId).toBe(keep.id);
    expect(p.blockers).toEqual([]);
    expect(p.drop).toMatchObject({ entityCode: keep.entityCode, pan: PAN });

    const q = await preview(keep.id, drop.id);
    expect(q.keep.counts.engagements).toBe(2);
    expect(q.drop.counts).toMatchObject({
      engagements: 3,
      registrations: 1,
      invoices: 1,
      receipts: 1,
    });
    expect(q.drop.gstins).toEqual([GSTIN_DL]);
    expect(q.fields.map((f) => f.field)).toEqual(['legal_name', 'entity_type_id']);
    expect(q.fields[0]).toMatchObject({
      keep: `${tag} Technologies Private Limited`,
      drop: `${tag} Technologies - Firm`,
    });
    const plan = Object.fromEntries(q.engagements.map((e) => [e.id, e.action]));
    expect(plan).toEqual({ [dropCompliance.id]: 'fold', [moved.id]: 'move', [clash.id]: 'stay' });
  });

  it('merges: registrations, engagements and billing move; the archived one points to the kept', async () => {
    const res = await http()
      .post(`/api/v1/entities/${keep.id}/merge`)
      .set(bearer(pa))
      .send({ dropId: drop.id });
    expect([res.status, res.body.message]).toEqual([201, undefined]);
    const r = res.body as MergeClientsResult;
    expect(r).toMatchObject({
      keptId: keep.id,
      keptCode: keep.entityCode,
      archivedId: drop.id,
      archivedCode: drop.entityCode,
      folded: { from: dropCompliance.engagementCode },
      counts: expect.objectContaining({ registrations: 1, receipts: 1, invoicesLeft: 0 }),
    });
    // The folded Compliance engagement and the GST one moved; the clashing one stayed.
    expect(r.movedEngagements).toBe(2);
    expect(r.stayed).toEqual([
      expect.objectContaining({ kind: 'engagement', code: clash.engagementCode }),
    ]);

    const kept = await http().get(`/api/v1/entities/${keep.id}`).set(bearer(pa)).expect(200);
    expect(kept.body).toMatchObject({
      legalName: `${tag} Technologies Private Limited`,
      pan: PAN,
      mergedInto: null,
    });
    expect(
      kept.body.registrations.map((x: { registrationNumber: string }) => x.registrationNumber),
    ).toEqual([GSTIN_DL]);
    const archived = await http().get(`/api/v1/entities/${drop.id}`).set(bearer(pa)).expect(200);
    expect(archived.body).toMatchObject({
      status: 'archived',
      mergedInto: { id: keep.id, entityCode: keep.entityCode },
    });

    const { rows: billing } = await su.query<{ inv: string; rcpt: string }>(
      `SELECT (SELECT client_entity_id FROM hsdg.invoices WHERE id = $1) AS inv,
              (SELECT client_entity_id FROM hsdg.receipts WHERE reference = $2) AS rcpt`,
      [invoiceId, `UTR${tag}`],
    );
    expect(billing[0]).toEqual({ inv: keep.id, rcpt: keep.id });

    // One Compliance engagement: both years, both streams; the other is merged into it.
    const years = await http()
      .get(`/api/v1/engagements/${keepCompliance}/years`)
      .set(bearer(pa))
      .expect(200);
    expect(years.body).toEqual([
      expect.objectContaining({ financialYear: '2026-27', streams: ['gst', 'tds'] }),
      expect.objectContaining({ financialYear: '2027-28', streams: ['gst', 'tds'] }),
    ]);
    const { rows: engs } = await su.query<{
      id: string;
      entity_id: string;
      status: string;
      merged_into_id: string | null;
    }>(
      `SELECT id, entity_id, status, merged_into_id FROM hsdg.engagements WHERE id = ANY($1::uuid[])`,
      [[dropCompliance.id, moved.id, clash.id]],
    );
    const byId = Object.fromEntries(engs.map((e) => [e.id, e]));
    expect(byId[dropCompliance.id]).toMatchObject({
      entity_id: keep.id,
      status: 'merged',
      merged_into_id: keepCompliance,
    });
    expect(byId[moved.id]).toMatchObject({ entity_id: keep.id });
    expect(byId[clash.id]).toMatchObject({ entity_id: drop.id });

    const audit = await su.query(
      `SELECT 1 FROM hsdg.audit_events WHERE action = 'entity.merged' AND object_id = $1`,
      [keep.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('leaves the archived client out of the list and the duplicates, and will not merge it again', async () => {
    const list = await http()
      .get(`/api/v1/entities?search=${tag}&limit=100`)
      .set(bearer(pa))
      .expect(200);
    expect(list.body.items.map((e: { id: string }) => e.id)).toEqual([keep.id]);
    const dups = (await http().get('/api/v1/entities/duplicates').set(bearer(pa)).expect(200))
      .body as DuplicatePair[];
    expect(dups.some((p) => [p.a.id, p.b.id].includes(drop.id))).toBe(false);
    await http()
      .post(`/api/v1/entities/${keep.id}/merge`)
      .set(bearer(pa))
      .send({ dropId: drop.id })
      .expect(400);
  });

  it('never merges two PANs: the preview blocks and the merge is refused', async () => {
    const a = await createClient({
      legalName: `${tag} Drift Pvt Ltd`,
      typeSlug: 'private_limited',
      pan: pan('C'),
    });
    const b = await createClient({
      legalName: `${tag} Drift Private Limited`,
      typeSlug: 'private_limited',
      pan: pan('C'),
    });
    const p = await preview(a.id, b.id);
    expect(p.verdict).toBe('different');
    expect(p.blockers[0]).toMatch(/Different PANs/);
    const res = await http()
      .post(`/api/v1/entities/${a.id}/merge`)
      .set(bearer(pa))
      .send({ dropId: b.id })
      .expect(400);
    expect(res.body.message).toMatch(/Different PANs/);
  });

  it('takes the values chosen from the archived client, and "not the same client" hides a pair', async () => {
    const a = await createClient({ legalName: `${tag} Cosmo Trends`, typeSlug: 'proprietorship' });
    const b = await createClient({
      legalName: `${tag} Cosmo Trends (Delhi`,
      typeSlug: 'proprietorship',
      tradeName: 'Cosmo',
    });
    const c = await createClient({ legalName: `${tag} Cosmo Trend`, typeSlug: 'proprietorship' });
    const pairOf = async (x: string, y: string) =>
      (
        (await http().get('/api/v1/entities/duplicates').set(bearer(pa)).expect(200))
          .body as DuplicatePair[]
      ).find((p) => [p.a.id, p.b.id].sort().join() === [x, y].sort().join());
    expect(await pairOf(a.id, c.id)).toMatchObject({ verdict: 'probable' });
    await http()
      .post('/api/v1/entities/duplicates/dismiss')
      .set(bearer(pa))
      .send({ aId: c.id, bId: a.id, note: 'Two shops of two brothers' })
      .expect(204);
    expect(await pairOf(a.id, c.id)).toBeUndefined();

    await http()
      .post(`/api/v1/entities/${a.id}/merge`)
      .set(bearer(pa))
      .send({ dropId: b.id, take: ['legal_name'] })
      .expect(201);
    const kept = await http().get(`/api/v1/entities/${a.id}`).set(bearer(pa)).expect(200);
    // The chosen name, and the trade name the kept one lacked.
    expect(kept.body).toMatchObject({
      legalName: `${tag} Cosmo Trends (Delhi`,
      tradeName: 'Cosmo',
    });
  });

  it('is for those who manage clients', async () => {
    const sy = await token('senior.y@dhvaj.in');
    await http().get('/api/v1/entities/duplicates').set(bearer(sy)).expect(403);
    await http()
      .post(`/api/v1/entities/${keep.id}/merge`)
      .set(bearer(sy))
      .send({ dropId: drop.id })
      .expect(403);
  });
});
