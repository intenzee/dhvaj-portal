-- ─────────────────────────────────────────────────────────────────────────
-- Payroll · pension (EPS) membership on a pay structure.
--
-- Someone who first joins PF after 1 Sep 2014 on PF wages above the ceiling
-- (EPS para 6A), or who is past 58, is not in the pension scheme: the whole
-- 12% employer share goes to their EPF account, none to EPS. Common for a
-- newly qualified CA hired on a high basic, so it is a choice on the
-- structure, as PF / ESI / PT applicability already are. Default: a member.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.salary_structures ADD COLUMN eps_member boolean NOT NULL DEFAULT true;

-- Down Migration

ALTER TABLE hsdg.salary_structures DROP COLUMN IF EXISTS eps_member;
