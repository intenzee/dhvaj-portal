-- ─────────────────────────────────────────────────────────────────────────
-- Anyone who may bill the client may edit an invoice's lines
--
-- WHY: the invoice itself is edited by whoever may bill its client
-- (ctx_can_bill), but its lines only by the engagement's own members — so a
-- manager billing the client from the office could fix the notes but not a
-- wrong amount. The lines now follow the invoice. The edit guards
-- (invoice_line_guard_draft, a filed GSTR-1, money received) still apply.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE POLICY invoice_line_items_insert_biller ON hsdg.invoice_line_items
  FOR INSERT TO hsdg_app
  WITH CHECK (EXISTS (SELECT 1 FROM hsdg.invoices i
                       WHERE i.id = invoice_line_items.invoice_id
                         AND hsdg.ctx_can_bill(i.client_entity_id)));
CREATE POLICY invoice_line_items_update_biller ON hsdg.invoice_line_items
  FOR UPDATE TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.invoices i
                  WHERE i.id = invoice_line_items.invoice_id
                    AND hsdg.ctx_can_bill(i.client_entity_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM hsdg.invoices i
                       WHERE i.id = invoice_line_items.invoice_id
                         AND hsdg.ctx_can_bill(i.client_entity_id)));
CREATE POLICY invoice_line_items_delete_biller ON hsdg.invoice_line_items
  FOR DELETE TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.invoices i
                  WHERE i.id = invoice_line_items.invoice_id
                    AND hsdg.ctx_can_bill(i.client_entity_id)));

-- Down Migration

DROP POLICY IF EXISTS invoice_line_items_delete_biller ON hsdg.invoice_line_items;
DROP POLICY IF EXISTS invoice_line_items_update_biller ON hsdg.invoice_line_items;
DROP POLICY IF EXISTS invoice_line_items_insert_biller ON hsdg.invoice_line_items;
