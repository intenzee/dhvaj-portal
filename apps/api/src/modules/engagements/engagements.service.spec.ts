import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { serviceStatusFromEngagement, translatePgError } from './engagements.service';

describe('serviceStatusFromEngagement (multi-service)', () => {
  it('maps an engagement stage to a faithful initial service status', () => {
    expect(serviceStatusFromEngagement('prospect')).toBe('prospect');
    expect(serviceStatusFromEngagement('pending_acceptance')).toBe('prospect');
    expect(serviceStatusFromEngagement('accepted')).toBe('active');
    expect(serviceStatusFromEngagement('active')).toBe('active');
    expect(serviceStatusFromEngagement('on_hold')).toBe('on_hold');
    expect(serviceStatusFromEngagement('completed')).toBe('completed');
    expect(serviceStatusFromEngagement('closed')).toBe('completed');
    expect(serviceStatusFromEngagement('declined')).toBe('cancelled');
    expect(serviceStatusFromEngagement('withdrawn')).toBe('cancelled');
    expect(serviceStatusFromEngagement('cancelled')).toBe('cancelled');
  });
});

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

  it('maps the grade-rules trigger (P0001) to a 400 that surfaces the reason', () => {
    const e = translatePgError({
      code: 'P0001',
      message: 'Engagement Partner must be a partner-grade employee.',
    });
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message).toMatch(/partner-grade/i);
  });

  it('maps an RLS violation to 403', () => {
    expect(translatePgError({ code: '42501' })).toBeInstanceOf(ForbiddenException);
  });

  it('passes through unrecognised errors', () => {
    const orig = new Error('x');
    expect(translatePgError(orig)).toBe(orig);
  });
});
