import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Portal passwords — what is refused: repeated wrong passwords lock it, an
 * unknown email fails like a wrong password, and an MFA-required account must
 * use Microsoft.
 */
describe('Password sign-in refusals (e2e)', () => {
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

  const userWithTemporary = async (
    email: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; temp: string }> => {
    const admin = bearer(await token('admin@dhvaj.in'));
    const created = await http()
      .post('/api/v1/users')
      .set(admin)
      .send({ email, displayName: 'Locked Out', officeCode: 'NORTH', roles: ['article'], ...extra })
      .expect(201);
    const pw = await http()
      .post(`/api/v1/users/${created.body.id}/password`)
      .set(admin)
      .expect(201);
    return { id: created.body.id as string, temp: pw.body.temporaryPassword as string };
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('locks after five wrong passwords; an admin reset lifts the lock', async () => {
    const email = `lock.${uniq()}@dhvaj.in`;
    const { id, temp } = await userWithTemporary(email);

    for (let i = 1; i <= 4; i++) {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: `wrong-${i}` })
        .expect(401);
      expect(res.body.message).toBe('Email or password is incorrect.');
    }
    const fifth = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-5' })
      .expect(401);
    expect(fifth.body.message).toMatch(/Too many wrong passwords/);
    // Even the right password waits out the lock.
    const right = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: temp })
      .expect(401);
    expect(right.body.message).toMatch(/Too many wrong passwords/);

    const status = await http()
      .get('/api/v1/user-passwords')
      .set(bearer(await token('admin@dhvaj.in')))
      .expect(200);
    expect(status.body[id].locked).toBe(true);

    const reset = await http()
      .post(`/api/v1/users/${id}/password`)
      .set(bearer(await token('admin@dhvaj.in')))
      .expect(201);
    const after = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: reset.body.temporaryPassword })
      .expect(201);
    expect(after.body).toEqual({ mustChangePassword: true });
  });

  it('an unknown email fails exactly like a wrong password', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: `nobody.${uniq()}@dhvaj.in`, password: 'Monsoon-Ledger-42' })
      .expect(401);
    expect(res.body.message).toBe('Email or password is incorrect.');
  });

  it('an account that requires MFA must sign in with Microsoft', async () => {
    const email = `mfa.${uniq()}@dhvaj.in`;
    const { temp } = await userWithTemporary(email, { mfaRequired: true });
    const res = await http().post('/api/v1/auth/login').send({ email, password: temp }).expect(401);
    expect(res.body.message).toBe('This account must sign in with Microsoft.');
  });

  it('the new password must differ and follow the rules; a wrong current one is refused', async () => {
    const email = `rules.${uniq()}@dhvaj.in`;
    const { temp } = await userWithTemporary(email);
    await http()
      .post('/api/v1/auth/password')
      .send({ email, currentPassword: 'not-it-at-all', newPassword: 'Monsoon-Ledger-42' })
      .expect(401);
    const same = await http()
      .post('/api/v1/auth/password')
      .send({ email, currentPassword: temp, newPassword: temp })
      .expect(400);
    expect(same.body.message).toMatch(/different/);
  });
});
