import { translatePgError as mapPgError } from '../../common/errors/pg-error.util';

/** Messages raised by the engagement-kind guards (foundation migration). */
const KIND_RULE_MESSAGE =
  /^(A Statutory Audit engagement|A Compliance engagement|An assignment cannot|Years in scope)/;

/** Map PostgreSQL constraint/RLS violations to clean HTTP errors (engagement domain). */
export function translatePgError(err: unknown): Error {
  return mapPgError(err, {
    unique: [
      {
        match: 'identity',
        message: 'An engagement already exists for this client, service, year and period.',
      },
      { match: 'engagement_team', message: 'That employee is already on the engagement team.' },
      {
        match: 'one_open_compliance',
        message:
          'This client already has an open Compliance engagement — add a year or stream to it instead.',
      },
    ],
    uniqueDefault: 'A duplicate value violates a unique constraint.',
    foreignKey: 'A referenced record does not exist.',
    // The kind guards raise check_violation with a fixed, developer-authored
    // message naming the rule; any other check is the EP requirement.
    check: (message) =>
      message && KIND_RULE_MESSAGE.test(message)
        ? message
        : 'Invalid engagement state — an accepted engagement requires an Engagement Partner.',
    // Raised by the engagement grade-/review-plan triggers; the message is a
    // fixed, developer-authored string — safe to surface when short.
    raise: (message) =>
      message && message.length <= 200 ? message : 'Invalid engagement accountability.',
    forbidden: 'Not permitted to write this engagement.',
  });
}
