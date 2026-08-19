import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { translatePgError } from './engagements.service';

describe('translatePgError (engagements)', () => {
  it('maps the identity unique violation to 409 with an identity message', () => {
    const e = translatePgError({ code: '23505', constraint: 'engagements_identity_unique' });
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.message).toMatch(/client, service, year and period/i);
  });

  it('maps a duplicate team member to 409', () => {
    const e = translatePgError({ code: '23505', constraint: 'engagement_team_unique' });
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.message).toMatch(/team/i);
  });

  it('maps the EP-required check violation to a helpful 400', () => {
    const e = translatePgError({ code: '23514' });
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message).toMatch(/Engagement Partner/i);
  });

  it('maps a foreign-key violation to 400', () => {
    expect(translatePgError({ code: '23503' })).toBeInstanceOf(BadRequestException);
  });

  it('maps an RLS violation to 403', () => {
    expect(translatePgError({ code: '42501' })).toBeInstanceOf(ForbiddenException);
  });

  it('passes through unrecognised errors', () => {
    const orig = new Error('x');
    expect(translatePgError(orig)).toBe(orig);
  });
});
