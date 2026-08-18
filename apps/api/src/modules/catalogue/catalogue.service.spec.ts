import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { meetsReviewRequirement } from '@hsdg/contracts';
import { translatePgError } from './catalogue.service';

describe('translatePgError (catalogue)', () => {
  it('maps a unique violation to 409', () => {
    expect(translatePgError({ code: '23505' })).toBeInstanceOf(ConflictException);
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

describe('meetsReviewRequirement (review-model rank rule)', () => {
  const MANAGER = 10;
  const KEY_MATTER = 20;
  const FULL_EP = 30;

  it('accepts an equal or higher review model', () => {
    expect(meetsReviewRequirement(FULL_EP, FULL_EP)).toBe(true);
    expect(meetsReviewRequirement(MANAGER, KEY_MATTER)).toBe(true);
    expect(meetsReviewRequirement(MANAGER, FULL_EP)).toBe(true);
  });

  it('rejects a lower review model than required (e.g. no Manager-only statutory audit)', () => {
    expect(meetsReviewRequirement(FULL_EP, MANAGER)).toBe(false);
    expect(meetsReviewRequirement(FULL_EP, KEY_MATTER)).toBe(false);
    expect(meetsReviewRequirement(KEY_MATTER, MANAGER)).toBe(false);
  });
});
