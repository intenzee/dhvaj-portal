import {
  generateTemporaryPassword,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from './passwords';

describe('portal passwords', () => {
  it('hashes with a salt and verifies only the right password', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(a).not.toBe(b); // salted
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('correct horse batterz', a)).toBe(false);
  });

  it('refuses a malformed hash instead of throwing', async () => {
    expect(await verifyPassword('x', 'plain-text')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1$2$3$$')).toBe(false);
  });

  it('makes readable temporary passwords that pass the rules', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const t = generateTemporaryPassword();
      expect(t).toMatch(
        /^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/,
      );
      expect(passwordProblem(t, 'ravi.kumar@dhvaj.in')).toBeNull();
      seen.add(t);
    }
    expect(seen.size).toBe(50);
  });

  it('explains a weak password', () => {
    expect(passwordProblem('short1', 'a@dhvaj.in')).toMatch(/at least 10/);
    expect(passwordProblem('aaaaaaaaaaaa', 'a@dhvaj.in')).toMatch(/repetitive/);
    expect(passwordProblem('ravi.kumar2026!', 'ravi.kumar@dhvaj.in')).toMatch(/email name/);
    expect(passwordProblem('MyPassword2026', 'x@dhvaj.in')).toMatch(/too easy/);
    expect(passwordProblem('Monsoon-Ledger-42', 'ravi.kumar@dhvaj.in')).toBeNull();
  });
});
