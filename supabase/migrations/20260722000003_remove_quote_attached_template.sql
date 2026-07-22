-- Remove the "הצעת מחיר מצורפת" default WhatsApp template.
--
-- This text-only template ("היי {{שם}}, מצורפת הצעת המחיר שלך…") was seeded by
-- 20260710000001_whatsapp_phase2.sql, but it's misleading: picking it only
-- writes the sentence — it does NOT attach the PDF. Sending the real quote/order
-- PDF is now a dedicated "שלח" action on each quote/order (in the chat's customer
-- panel and on the quote/order screens), so this template is dropped to avoid
-- confusion.
--
-- Scoped to the UNMODIFIED default (shortcut + exact title) so a template a user
-- may have repurposed under the same shortcut is left untouched. Idempotent —
-- deleting a non-existent row is a no-op, safe to re-run.

BEGIN;

DELETE FROM public.whatsapp_templates
WHERE shortcut = 'מחיר1'
  AND title = 'הצעת מחיר מצורפת';

COMMIT;
