import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Portal passwords through the HTTP API: an admin gives a temporary password,
 * the person replaces it at first sign-in, signs in with email + password,
 * and a reset ends their old sessions. (Lockout and refusals:
 * password-lockout.e2e-spec.ts — /auth/login is rate-limited per file.)
 */
describe('Password sign-in (e2e)', () => {
  let app: INestApplication;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const uniq = () => Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000);
  const http = () => request(app.getHttpServer());

  const newUser = async (email: string, extra: Record<string, unknown> = {}): Promise<string> => {
    const res = await http()
      .post('/api/v1/users')
      .set(bearer(await token('admin@dhvaj.in')))
      .send({
        email,
        displayName: 'Password Person',
        officeCode: 'NORTH',
        roles: ['senior'],
        ...extra,
      })
      .expect(201);
    return res.body.id as string;
  };
  const giveTemporary = async (userId: string): Promise<string> => {
    const res = await http()
      .post(`/api/v1/users/${userId}/password`)
      .set(bearer(await token('admin@dhvaj.in')))
      .expect(201);
    return res.body.temporaryPassword as string;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('first sign-in with a temporary password, then email + password from then on', async () => {
    const email = `pw.${uniq()}@dhvaj.in`;
    const id = await newUser(email);
    const temp = await giveTemporary(id);
    expect(temp).toMatch(/^\w{4}-\w{4}-\w{4}$/);

    const status = await http()
      .get('/api/v1/user-passwords')
      .set(bearer(await token('admin@dhvaj.in')))
      .expect(200);
    expect(status.body[id]).toEqual({ mustChange: true, locked: false });

    // The temporary password only lets them choose their own.
    const first = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: temp })
      .expect(201);
    expect(first.body).toEqual({ mustChangePassword: true });

    const weak = await http()
      .post('/api/v1/auth/password')
      .send({ email, currentPassword: temp, newPassword: 'short1' })
      .expect(400);
    expect(weak.body.message).toMatch(/at least 10/);

    const changed = await http()
      .post('/api/v1/auth/password')
      .send({ email, currentPassword: temp, newPassword: 'Monsoon-Ledger-42' })
      .expect(201);
    const me = await http()
      .get('/api/v1/auth/me')
      .set(bearer(changed.body.accessToken))
      .expect(200);
    expect(me.body.principal.userId).toBe(id);
    expect(me.body.principal.authMethod).toBe('password');
    expect(me.body.principal.roles).toEqual(['senior']);

    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: email.toUpperCase(), password: 'Monsoon-Ledger-42' })
      .expect(201);
    expect(login.body.tokenType).toBe('Bearer');

    // The portal renews a password session while it is in use.
    const renewed = await http()
      .post('/api/v1/auth/renew')
      .set(bearer(login.body.accessToken))
      .expect(201);
    await http().get('/api/v1/auth/me').set(bearer(renewed.body.accessToken)).expect(200);

    const wrong = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'Monsoon-Ledger-43' })
      .expect(401);
    expect(wrong.body.message).toBe('Email or password is incorrect.');

    // A reset ends every session issued under the old password.
    await giveTemporary(id);
    const ended = await http()
      .get('/api/v1/auth/me')
      .set(bearer(renewed.body.accessToken))
      .expect(401);
    expect(ended.body.message).toMatch(/password was changed/);

    const audit = await http()
      .get('/api/v1/audit?limit=100')
      .set(bearer(await token('mp@dhvaj.in')))
      .expect(200);
    const actions = (audit.body.items as Array<{ action: string; objectId: string }>)
      .filter((e) => e.objectId === id)
      .map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'user.password_set',
        'auth.password_changed',
        'auth.password_login',
        'user.password_reset',
      ]),
    );
  });

  it('only an administrator can give a password (403), and never sees an old one', async () => {
    const id = await newUser(`pw.${uniq()}@dhvaj.in`);
    await http()
      .post(`/api/v1/users/${id}/password`)
      .set(bearer(await token('partner.a@dhvaj.in')))
      .expect(403);
    await http()
      .get('/api/v1/user-passwords')
      .set(bearer(await token('partner.a@dhvaj.in')))
      .expect(403);
  });

  it('turning password sign-in off for a user (Microsoft only)', async () => {
    const email = `pw.${uniq()}@dhvaj.in`;
    const id = await newUser(email);
    const temp = await giveTemporary(id);
    await http()
      .delete(`/api/v1/users/${id}/password`)
      .set(bearer(await token('admin@dhvaj.in')))
      .expect(204);
    const res = await http().post('/api/v1/auth/login').send({ email, password: temp }).expect(401);
    expect(res.body.message).toBe('Email or password is incorrect.');
  });

  it('a deactivated user cannot sign in with a password', async () => {
    const email = `pw.${uniq()}@dhvaj.in`;
    const id = await newUser(email);
    const temp = await giveTemporary(id);
    await http()
      .patch(`/api/v1/users/${id}`)
      .set(bearer(await token('admin@dhvaj.in')))
      .send({ isActive: false })
      .expect(200);
    const res = await http().post('/api/v1/auth/login').send({ email, password: temp }).expect(401);
    expect(res.body.message).toBe('This account is inactive.');
  });
});
