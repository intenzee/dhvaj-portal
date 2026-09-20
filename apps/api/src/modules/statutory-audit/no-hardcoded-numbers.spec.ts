import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Mechanical guard for Implementation Guide principle #2 / §15.6: NO statutory
 * number lives in the Section 02 framework engines. Every threshold, ratio and
 * effective date must resolve from the Audit Rules Library through the injected
 * RuleResolver — a literal in engine code fails this test regardless of whether
 * the number is currently correct.
 *
 * Scans the pure engine files (framework-suggestions.ts and any future
 * framework/<subsection>.ts), ignoring comments and string literals (basis
 * strings interpolate resolved values, they never hard-code them). It flags:
 *   • the `CRORE` token (the old hard-coded unit constant), and
 *   • any bare numeric literal of 5+ digits (statutory rupee amounts are ≥ ₹1 lakh).
 */

function engineFiles(): string[] {
  const files = [join(__dirname, 'framework-suggestions.ts')];
  const dir = join(__dirname, 'framework');
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) files.push(join(dir, name));
    }
  }
  return files.filter(existsSync);
}

/** Remove line/block comments and string/template literals so only code remains. */
function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/\/\/[^\n]*/g, ' ') // line comments
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, '``') // template literals
    .replace(/'(?:\\.|[^\\'])*'/g, "''") // single-quoted
    .replace(/"(?:\\.|[^\\"])*"/g, '""'); // double-quoted
}

describe('no hard-coded statutory numbers in the framework engines (§15.6)', () => {
  const files = engineFiles();

  it('scans at least the framework-suggestions engine', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s contains no statutory numeric literals or CRORE constant', (file) => {
    const code = stripCommentsAndStrings(readFileSync(file, 'utf8'));
    const offenders: string[] = [];

    if (/\bCRORE\b/.test(code)) offenders.push('CRORE token');

    for (const m of code.matchAll(/\b\d[\d_]{4,}\b/g)) {
      offenders.push(`numeric literal "${m[0]}"`);
    }

    expect(offenders).toEqual([]);
  });
});
