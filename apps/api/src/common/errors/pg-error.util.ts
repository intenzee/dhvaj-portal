import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

/**
 * How to translate the PostgreSQL error codes a domain cares about into clean
 * HTTP errors. Each domain supplies its own messages (especially the unique-
 * constraint mapping); the code → HTTP-status structure is shared here so it is
 * defined once. Unhandled codes fall through as the original error.
 */
export interface PgErrorMap {
  /** 23505 unique_violation — first constraint-substring match wins. */
  unique?: Array<{ match: string; message: string }>;
  uniqueDefault?: string;
  /** 23503 foreign_key_violation. */
  foreignKey?: string;
  /** 23514 check_violation — a fixed message, or one derived from the raw message. */
  check?: string | ((raw: string | undefined) => string);
  /** P0001 raise_exception (a trigger's RAISE) — message derived from the raw message. */
  raise?: (raw: string | undefined) => string;
  /** 42501 insufficient_privilege (an RLS denial). */
  forbidden?: string;
}

/** Map a PostgreSQL constraint/RLS violation to a clean HTTP error, per {@link PgErrorMap}. */
export function translatePgError(err: unknown, map: PgErrorMap): Error {
  const e = err as { code?: string; constraint?: string; message?: string };
  switch (e.code) {
    case '23505': {
      const hit = map.unique?.find((u) => e.constraint?.includes(u.match));
      return new ConflictException(
        hit?.message ?? map.uniqueDefault ?? 'A duplicate value violates a unique constraint.',
      );
    }
    case '23503':
      return new BadRequestException(map.foreignKey ?? 'A referenced record does not exist.');
    case '23514':
      if (map.check !== undefined) {
        return new BadRequestException(
          typeof map.check === 'function' ? map.check(e.message) : map.check,
        );
      }
      return new BadRequestException('A value violates a check constraint.');
    case 'P0001':
      if (map.raise) return new BadRequestException(map.raise(e.message));
      return err as Error;
    case '42501':
      return new ForbiddenException(map.forbidden ?? 'Not permitted to write this record.');
    default:
      return err as Error;
  }
}
