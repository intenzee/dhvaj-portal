# ADR-0014 — Tasks & Client Dependencies

- **Status:** Accepted
- **Date:** 2026-08-20
- **Phase:** 9 (Tasks & Client Dependencies)

## Context

Phase 9 adds two operational concerns to the engagement, and the brief (§11) is
specific that they must be tellable apart: whose delay is it — **ours** or the
**client's**? A task past its due date is an internal delay; information the firm
is still waiting on from the client is a client delay, and while any such request
is open the engagement is **WAITING FOR CLIENT** — "a first-class operational
state".

## Decisions

### 1. Two tables, one distinction surfaced on the engagement

`tasks` are internal work items (title, assignee, priority, due date, status)
with `task_dependencies` (a task blocked until another is done).
`client_dependencies` are requests to the client (requested info, outstanding
items, responsible employee, request/reminder/escalation/receipt dates, status).

The engagement read model derives four operational fields from these:
`isWaitingForClient` (an open client dependency exists), `openTaskCount`,
`internallyOverdueTaskCount` (open tasks past their due date), and
`clientOverdueCount` (open client dependencies past their escalation date). This
is the §11 distinction made queryable — **internal** vs **client** delay, side by
side, computed (never a denormalised flag that can drift).

### 2. WAITING_FOR_CLIENT is derived, not a lifecycle status

The guarded lifecycle state machine (ADR-0011) is deliberately left alone.
`WAITING_FOR_CLIENT` is not a new `engagements.status` value — it is derived from
open client dependencies. An engagement is `ACTIVE` *and* waiting-for-client;
requesting information doesn't move it through the lifecycle. This keeps the
state machine small and the operational signal always-consistent with the data.

### 3. The assignee may write — the one departure from "leads write"

The review and compliance engines are lead-write only. Tasks add a second write
vector: a task's **assignee** (who may be a senior or article, without
`engagement.manage`) may progress *their own* task. Enforced with a new
`task.update` permission (granted to every engagement-working role, not the
platform admin) plus an RLS `UPDATE` policy of `is_engagement_lead(engagement_id)
OR assigned_to_employee_id = ctx_employee_id()`. Create / assign / reassign /
dependency management stay lead-only (`engagement.manage`). Proven at the DB
layer: the assignee updates their task, a member who is neither assignee nor lead
cannot.

### 4. Assignees must be engagement members

A task is only assignable to an employee already on the engagement (EP, manager,
or team), validated in the service. This keeps RLS simple — the engagement-member
`SELECT` policy already covers assignees, so an assignee always sees their task
and its engagement (no separate task-assignment visibility vector to thread
through the helpers).

### 5. Dependencies block completion and cannot cycle

A task cannot be marked `done` while it still has a blocker that is neither done
nor cancelled (checked from the read model's `blockedByOpenCount`). Adding a
dependency runs a recursive-CTE reachability check and rejects any edge that
would close a cycle; a self-dependency is blocked by a CHECK. A trigger enforces
that both ends of a dependency belong to the same engagement.

### 6. A transaction-visibility pitfall worth recording

`addDependency`/`removeDependency` first returned their result by calling
`getOne`, which opened its **own** `withRlsContext` transaction — on a separate
pooled connection that could not see the still-uncommitted insert, so
`blockedByOpenCount` read 0. Fixed by extracting `selectTaskDetail(client, …)`
and building the response on the **same** transaction client. (General rule: a
mutation must build its response from the client it mutated on, never by
re-entering a fresh `withRlsContext`.)

### 7. Firm-wide "My Work" views

`GET /work/tasks` (tasks assigned to me) and `GET /work/client-dependencies`
(open dependencies I'm waiting on) aggregate across every engagement the caller
can see (RLS-scoped), each with engagement/entity context and an `overdueOnly`
filter — the data behind the My Work and Client Dependencies navigation.

## Consequences

- Requesting client information flips `isWaitingForClient` true; receiving it
  fully flips it back — proven end-to-end, with the internal task delay
  unaffected throughout (the two clocks are independent).
- Seniors/articles can drive their own tasks without any lead permission, while
  governance actions stay lead-only.
- Every task/dependency/client-dependency mutation is audited.

## Known limitations / deferred (not gold-plated)

- **Reminders/escalation are dates, not dispatch.** The engine records reminder
  and escalation dates and derives `reminderDue` / overdue, but does not *send*
  anything — reminder/escalation notifications are Phase 11 (notifications),
  which will read these fields.
- **No recurring tasks / templates.** Tasks are created per engagement; a
  task-template or checklist mechanism is future work.
- **Closing a received dependency is permitted** (no status-transition guard on
  `close` beyond RLS) — an unusual but harmless operation; a small guard can be
  added if the firm wants it.

## Follow-ups for Phase 10

- Documents attach to engagements (and could attach to a task or a client
  dependency as the evidence of receipt) — the client-dependency receipt is a
  natural anchor for an uploaded document in Phase 10.
