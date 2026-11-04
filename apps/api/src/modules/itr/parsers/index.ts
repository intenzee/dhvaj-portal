import type { ItrIncomeSource } from '@hsdg/contracts';
import { form26asText } from './form-26as-text';
import { incomeSheet } from './income-sheet';
import { StatementRefused, type ParsedStatement, type StatementParser } from './statement';

export { StatementRefused } from './statement';
export type { ParsedIncomeLine, ParsedStatement, StatementParser } from './statement';

/** The formats the desk reads, most specific first. */
export const STATEMENT_PARSERS: StatementParser[] = [form26asText, incomeSheet];

/**
 * Read a statement, or refuse it with what to download instead. The AIS JSON
 * from the portal is encrypted (the AIS utility opens it) and the 26AS / AIS
 * PDFs are password-protected: the desk reads the text and CSV downloads.
 */
export function parseStatement(bytes: Buffer, source: ItrIncomeSource): ParsedStatement {
  const text = bytes.toString('utf8').replace(/^﻿/, '');
  if (text.startsWith('%PDF'))
    throw new StatementRefused(
      'PDFs are password-protected and not read. Download the 26AS as text, or the AIS / TIS as CSV.',
    );
  const head = text.trimStart();
  if (head.startsWith('{') || head.startsWith('['))
    throw new StatementRefused(
      'The AIS JSON download is encrypted for the AIS utility and is not read here. Download the AIS or TIS as CSV from the portal and import that.',
    );
  const parser = STATEMENT_PARSERS.find((p) => p.detect(bytes, text, source));
  if (!parser)
    throw new StatementRefused(
      'This file is not a format the desk reads: the 26AS text export (TRACES), or a CSV / Excel sheet with a header row.',
    );
  if (source !== '26as' && parser === form26asText)
    throw new StatementRefused('This is a Form 26AS export: import it as 26AS.');
  return parser.parse(bytes, text, source);
}
