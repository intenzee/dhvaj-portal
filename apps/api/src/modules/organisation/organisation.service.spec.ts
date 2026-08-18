import { BadRequestException, ConflictException } from '@nestjs/common';
import { translatePgError } from './organisation.service';

describe('translatePgError', () => {
  it('maps a unique violation (23505) to 409 Conflict', () => {
    expect(translatePgError({ code: '23505' })).toBeInstanceOf(ConflictException);
  });

  it('maps a foreign-key violation (23503) to 400 Bad Request', () => {
    expect(translatePgError({ code: '23503' })).toBeInstanceOf(BadRequestException);
  });

  it('maps a check violation (23514) to 400 Bad Request', () => {
    expect(translatePgError({ code: '23514' })).toBeInstanceOf(BadRequestException);
  });

  it('passes through unrecognised errors unchanged', () => {
    const original = new Error('boom');
    expect(translatePgError(original)).toBe(original);
  });
});
