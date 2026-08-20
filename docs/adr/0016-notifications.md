# ADR-0016 — Notifications

- **Status:** Accepted
- **Date:** 2026-08-20
- **Phase:** 11 (Notifications)

## Context

Phase 11 adds a notification framework (§ Phase 11). Material events across the
system — assignment, EP sign-off pending, EP changed, engagement reopened,
high-risk exceptions, and the date-driven SLA/deadline/reminder clocks recorded
by Phases 8–9 — must reach the right person, in-app now and over other channels
later. The brief asks specifically for a **channel abstraction** (Portal, Email,
Teams, future) and lists the initial event set.

## Decisions

### 1. One recipient-scoped table, written through a single narrow path

`notifications` is one row per recipient user, carrying a typed event, optional
engagement/object context for deep-linking, and that user's read state. RLS
scopes **reads and updates to the recipient** (`recipient_user_id =
ctx_user_id()`) — a user only ever sees and mutates their own inbox, MP included.

Crucially there is **no INSERT policy**: the application role cannot create a
notification directly. Every notification is written through the SECURITY DEFINER
`hsdg.emit_notification()` (owned by the migrator; the table runs ENABLE — not
FORCE — RLS, so the owner bypasses policies). That guarantees recipients are
always resolved by **business logic, never client input**, and the sender's own
RLS context is irrelevant to whom a notification can be addressed. The function
resolves the recipient **employee → its linked user** (skipping employees with no
login) and de-duplicates on an optional `dedup_key`, returning the recipient user
id when a new row was created (and NULL when it was a no-op).

### 2. Emission is atomic with the event; delivery is channel-abstracted

Domain services call `NotificationsService.emitWith(client, ctx, event)` **inside
their own transaction**, so a notification commits (or rolls back) atomically
with the change that caused it — a task assignment and its notification are never
out of step. The persisted row **is** the in-app "portal" channel; external
channels (email, Teams) implement a small `NotificationChannel` interface,
are selected by `NOTIFICATION_CHANNELS`, and are dispatched **best-effort** (a
channel throwing is logged, never propagated — it can't fail the domain
operation).

### 3. Two emission sources: in-request events and a date-driven sweep

Five events fire in-request, wired at their natural sites: **task_assigned**
(assignee), **ep_changed** (incoming + outgoing EP), **engagement_reopened**
(EP + manager), **ep_signoff_pending** (the EP, when a manager *clears* a review
on an EP-sign-off-required engagement with no open points), and
**high_risk_exception** (the EP, when a key-matter review point is raised).
Self-notification is suppressed.

The date-driven events can't be triggered by a request, so `POST
/notifications/scan` runs a sweep: **internal SLA overdue/approaching**,
**statutory deadline approaching**, and **client-dependency reminders**, reading
the clocks recorded by Phases 8–9. It is **idempotent** — every emission carries
an object-scoped `dedupKey`, so re-running never duplicates a nudge. Reads run
under the caller's RLS context, so the firm-wide operator (Managing Partner — the
identity a scheduled worker authenticates as, gated by `notification.scan`)
sweeps the whole firm, while anyone else would only sweep what they can see.

### 4. Permissions

`notification.read` (every role) governs the recipient-scoped inbox endpoints;
`notification.scan` (Managing Partner only) governs the sweep.

## Consequences

- Assigning a task, changing/sign-off-pending on a review, reassigning the EP,
  and reopening an engagement all surface a portal notification to the right
  person — proven end-to-end; the recipient sees it, others never do, and a
  non-recipient cannot even mark it read (404).
- The sweep turns the two compliance clocks and client-dependency reminders into
  notifications, and is safe to run on a schedule (idempotent), proven including
  the operator-only gate.
- The write path is provably narrow: the app role cannot INSERT a notification
  directly (RLS), only through the audited emit function (DB-level tests).

## Known limitations / deferred (not gold-plated)

- **External channels are stub transports.** Email/Teams log their intent rather
  than sending; real transports (Graph sendMail / Teams webhook) drop in behind
  the same interface. When they do, delivery should move to a **post-commit
  outbox worker** reading the persisted notifications — today external dispatch
  runs best-effort inside the emitting transaction, which is fine for stubs but
  not for real at-least-once sending.
- **The sweep is pull, not scheduled.** `POST /notifications/scan` is designed to
  be driven by a cron/worker (Azure Service Bus / scheduled job); the scheduler
  itself is future infrastructure.
- **`review_pending` is defined but not auto-emitted.** There is no explicit
  "submit for review" action yet; the type is reserved for when one exists.
- **No digest/preference model or retention.** Per-user channel preferences,
  batching/digests, and notification retention/cleanup are future work.
