# ADR-0034 — Engagement Time Tracking

- **Status:** Accepted
- **Date:** 2026-09-02
- **Phase:** Engagement time tracking (manual stopwatch + MIS)
- **Migration:** `db/migrations/1761400000000_engagement_time_tracking.sql`

## Context

Firm leadership needs to see how much time each person spends working on an
engagement. The wrinkle: a large part of the work happens **outside the portal**
— on tax-department portals, banking sites, spreadsheets, email — so the system
cannot infer effort from in-app activity, and an inactivity timeout would
silently discard real working time.

The requirement is therefore a **manual stopwatch**: a person clicks *Start
working* when they begin, the portal records a running session, and it keeps
counting until they explicitly *Stop* it — or until the engagement is closed.
The timer must never auto-stop on inactivity.

## Decision

Add an engagement child object, `hsdg.engagement_time_entries`, and a time-
tracking service/controller in the engagements module. The design reuses the
existing engagement security, audit, and MIS machinery rather than introducing a
parallel stack.

### 1. Data model — a session, running or closed

One row per work session: `engagement_id`, `employee_id`, `started_at`,
`ended_at` (**NULL ⇒ running**), `duration_seconds` (materialised on stop so
reports never recompute closed rows), an optional `note`, and a `stopped_reason`
(`manual` | `engagement_closed`). A `CHECK` keeps the two shapes consistent (a
running row has no duration/reason; a stopped row has both).

### 2. Invariant — one running timer per person, firm-wide

A person works on one thing at a time, so at most one running entry may exist
per employee across the whole firm. This is enforced by a **partial unique
index** `one_running_timer_per_employee ON (employee_id) WHERE ended_at IS NULL`
— the database is the source of truth, not application logic. The service turns
the violation into a friendly `409` that names the engagement still running.
Starting a second timer is **rejected** (not auto-switched) so a working session
is never ended by surprise.

### 3. Security — rides engagement assignment (no new permission)

Time is engagement child data, so it reuses the assignment-based RLS from
ADR-0008. The table runs `ENABLE` (not `FORCE`) RLS exactly like
`engagement_team`, so the migrator-owned `SECURITY DEFINER` helpers
`hsdg.is_engagement_member` / `hsdg.is_engagement_lead` work without policy
recursion, while the least-privilege app role stays governed:

- **SELECT** — any engagement member sees the engagement's time (team
  transparency; firm-wide via the helper).
- **INSERT** — `is_engagement_member(...) AND employee_id = ctx_employee_id()`:
  you start only *your own* timer, only on an engagement you're on.
- **UPDATE** (stop/annotate) — your own entry, or a lead/firm-wide role, so a
  manager can stop a subordinate's runaway timer.
- **DELETE** — firm-wide only (corrections stay a governance action).

No new permission slug: the endpoints reuse `engagement.read` (RLS does the real
gating), and the firm-wide report reuses `report.read` like the other MIS views.
Every write is audited (`time.started`, `time.stopped`, `time.auto_stopped`) in
the same transaction as the mutation, consistent with the rest of the codebase.

### 4. Close ⇒ prompt + terminal-state safety net

Work cannot continue on a completed/closed/cancelled/withdrawn/declined
engagement, so `EngagementLifecycleService.transition` calls
`TimeTrackingService.stopAllRunningWith(...)` **inside the same transaction** as
the status change whenever the destination is terminal. No timer can keep
ticking on dead work — even a teammate's — and the stop commits atomically with
the close. The web layer additionally prompts the person closing the engagement
to stop their own timer first (recording it as a `manual` stop), but correctness
does not depend on the UI.

### 5. Visibility

- **Per engagement** — a *Time* tab shows the caller's start/stop control (with a
  live clock) and a per-person totals table, visible to everyone assigned.
- **A global running-timer banner** in the top bar keeps the caller's running
  timer in view everywhere, since it never auto-stops.
- **Firm-wide** — `GET /reports/time` rolls up time per person across every
  engagement the caller can see (RLS-scoped), on the Reports & MIS page under
  `report.read`.

## Consequences

- Effort is captured faithfully even for off-portal work, and a running timer is
  always visible so it isn't forgotten; leadership gets per-person totals at both
  the engagement and firm level.
- A timer left running inflates a session until stopped or the engagement closes.
  This is the deliberate trade-off of a manual stopwatch that never auto-stops;
  the running banner and the close safety net are the guard rails.

## Deferred (not built here)

- Editable / back-dated / fully-manual time entries (log time you forgot).
- Idle detection or maximum-session caps.
- Billing integration (time-and-material rollups feeding invoices).
- Approval/lock workflow for submitted time.
