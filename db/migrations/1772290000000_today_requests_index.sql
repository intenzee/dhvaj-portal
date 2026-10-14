-- Up Migration
-- Staff Workflow WF-201 — GET /work/today reads the open client requests a
-- person is responsible for. Without this the "Waiting on client" group scans
-- every request in the firm; with it, it probes one person's open ones.
CREATE INDEX IF NOT EXISTS client_dependencies_responsible_open_idx
  ON hsdg.client_dependencies (responsible_employee_id)
  WHERE status IN ('pending', 'partially_received');

-- Down Migration
DROP INDEX IF EXISTS hsdg.client_dependencies_responsible_open_idx;
