import { UnprocessableEntityException } from '@nestjs/common';
import { GST_STATES, readGstin, stateCodeFromName, TAX_ID_ERROR } from '@hsdg/contracts';

export interface RegistrationState {
  /** What to store: the chosen code, else the GSTIN's prefix. */
  stateCode: string | null;
  /** Set when the chosen code is not the GSTIN's prefix (D8: confirm, not block). */
  mismatch: { expected: string; actual: string } | null;
}

/** A state as typed or sent — '07', 'Delhi', 'New Delhi' — as its GST code, else as given. */
export function normaliseStateCode(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  return stateCodeFromName(t) ?? t;
}

/**
 * CM-2 · the state a registration is saved with. For a GSTIN the first two
 * digits are its state; another state may be kept only once confirmed.
 * Pure — tested.
 */
export function registrationState(
  registrationType: string,
  number: string,
  chosen: string | null | undefined,
): RegistrationState {
  const code = normaliseStateCode(chosen);
  if (registrationType !== 'gstin') return { stateCode: code, mismatch: null };
  const read = readGstin(number);
  const prefix = read.stateName ? read.stateCode : null;
  const stateCode = code ?? prefix;
  return {
    stateCode,
    mismatch:
      prefix && stateCode && stateCode !== prefix ? { expected: prefix, actual: stateCode } : null,
  };
}

/** 422 the web turns into the in-place "Use Delhi (07) / Keep Haryana" prompt. */
export function stateMismatchError(
  gstin: string,
  m: { expected: string; actual: string },
): UnprocessableEntityException {
  const exp = GST_STATES[m.expected] ?? m.expected;
  const act = GST_STATES[m.actual] ?? m.actual;
  return new UnprocessableEntityException({
    code: TAX_ID_ERROR.stateMismatch,
    expected: m.expected,
    actual: m.actual,
    message: `GSTIN ${gstin} starts with ${m.expected}, which is ${exp}. You picked ${m.actual} ${act}. The first two digits of a GSTIN are always its state.`,
  });
}

/**
 * CM-2 · an address's state: the code (from the dropdown, or read from the
 * typed name) and the display text kept beside it until CM-9. `undefined`
 * fields are left as they are. Pure — tested.
 */
export function addressState(input: { stateCode?: string | null; state?: string | null }): {
  state_code?: string | null;
  state?: string | null;
} {
  if (input.stateCode === undefined && input.state === undefined) return {};
  const raw = input.stateCode !== undefined ? input.stateCode : input.state;
  const code = normaliseStateCode(raw);
  const known = code && GST_STATES[code] ? code : null;
  return {
    state_code: known,
    state: input.state !== undefined ? input.state : known ? GST_STATES[known]! : null,
  };
}
