-- ─────────────────────────────────────────────────────────────────────────
-- PS-301 · the partner risk dashboard: an index for each tile that had none
--
-- Each tile reads on its own (count and first page), so one slow tile never
-- holds the others up. The filing, task, write-off and credit-note tiles use
-- indexes already there; these three cover the appeal clock, the next hearing
-- and the open invoice balance by its due date.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE INDEX notices_appeal_due_idx ON hsdg.notices (appeal_due_on)
  WHERE status = 'order_received' AND appeal_due_on IS NOT NULL;
CREATE INDEX notices_next_hearing_idx ON hsdg.notices (next_hearing_on)
  WHERE status NOT IN ('closed', 'withdrawn') AND next_hearing_on IS NOT NULL;
CREATE INDEX invoices_open_due_idx ON hsdg.invoices ((COALESCE(due_date, issue_date)))
  WHERE status IN ('issued', 'partially_paid');

-- Down Migration

DROP INDEX IF EXISTS hsdg.invoices_open_due_idx;
DROP INDEX IF EXISTS hsdg.notices_next_hearing_idx;
DROP INDEX IF EXISTS hsdg.notices_appeal_due_idx;
