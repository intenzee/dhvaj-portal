-- Up Migration
-- Source links for the 02.1 View Provision / View Standard viewer (spec §3, §19).
-- Each link is the authoritative text of the exact version the library row
-- holds, so it is pinned to the row's effective_from (a later version gets its
-- own link when it supersedes this one):
--   • Companies Act, 2013 (Act 18 of 2013) — India Code, the Government's
--     consolidated text, for Sections 2(85) and 2(41).
--   • ICAI Standards on Auditing — the ICAI-hosted text: SA 299 (Revised,
--     periods on or after 1 April 2018); SA 402 and SA 510 (periods on or after
--     1 April 2010).
-- Rows whose link an administrator already set are left alone.
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.authority_provision p
   SET source_url = v.url
  FROM (VALUES
    ('COS_ACT_2_85', DATE '2014-04-01', 'https://www.indiacode.nic.in/handle/123456789/2114'),
    ('COS_ACT_2_41', DATE '2014-04-01', 'https://www.indiacode.nic.in/handle/123456789/2114'),
    ('SA_299',       DATE '2018-04-01', 'https://resource.cdn.icai.org/49657aasb39352.pdf'),
    ('SA_402',       DATE '2010-04-01', 'https://resource.cdn.icai.org/16840sa402revised.pdf'),
    ('SA_510',       DATE '2010-04-01', 'https://resource.cdn.icai.org/15390Link25_510text.pdf')
  ) AS v(code, effective_from, url)
 WHERE p.code = v.code
   AND p.effective_from = v.effective_from
   AND p.source_url IS NULL;

ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

-- Down Migration
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.authority_provision
   SET source_url = NULL
 WHERE (code, source_url) IN (
   ('COS_ACT_2_85', 'https://www.indiacode.nic.in/handle/123456789/2114'),
   ('COS_ACT_2_41', 'https://www.indiacode.nic.in/handle/123456789/2114'),
   ('SA_299',       'https://resource.cdn.icai.org/49657aasb39352.pdf'),
   ('SA_402',       'https://resource.cdn.icai.org/16840sa402revised.pdf'),
   ('SA_510',       'https://resource.cdn.icai.org/15390Link25_510text.pdf')
 );

ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;
