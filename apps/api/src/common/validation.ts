import { ValidationPipe, type ValidationPipeOptions } from '@nestjs/common';

/**
 * The single source of truth for global request validation. Used by both the
 * real bootstrap (main.ts) and the e2e test harness, so tests exercise exactly
 * the validation production runs — including `forbidNonWhitelisted`, which
 * rejects unknown fields rather than silently dropping them.
 */
export const validationPipeOptions: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};

export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe(validationPipeOptions);
}
