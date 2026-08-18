import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { translatePgError } from './entities.service';

describe('translatePgError (entities)', () => {
  it('maps a PAN unique violation to 409 with a PAN message', () => {
    const e = translatePgError({ code: '23505', constraint: 'entities_pan_unique' });
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.message).toMatch(/PAN/i);
  });

  it('maps a registration unique violation to 409', () => {
    const e = translatePgError({ code: '23505', constraint: 'entity_registrations_number_unique' });
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.message).toMatch(/registration/i);
  });

  it('maps an RLS violation (42501) to 403', () => {
    expect(translatePgError({ code: '42501' })).toBeInstanceOf(ForbiddenException);
  });

  it('maps a foreign-key violation (23503) to 400', () => {
    expect(translatePgError({ code: '23503' })).toBeInstanceOf(BadRequestException);
  });

  it('maps a check violation (23514) to 400', () => {
    expect(translatePgError({ code: '23514' })).toBeInstanceOf(BadRequestException);
  });

  it('passes through unrecognised errors', () => {
    const orig = new Error('boom');
    expect(translatePgError(orig)).toBe(orig);
  });
});
