-- A WhatsApp template category of its own for orders.
--
-- The "שלח בוואטסאפ" button on an order pulled its message from the 'sales'
-- category, which is where the quote templates live. One text had to serve two
-- documents that say opposite things: a quote asks the customer to decide, an
-- order confirms a decision already made. Reps ended up sending "מצורפת הצעת
-- המחיר שלך" attached to a signed order.
--
-- `category` is CHECK-constrained, so adding a category is a schema change and
-- not just a line in the client's dropdown. The constraint is rebuilt with
-- 'orders' added and a starter template is seeded, guarded on its shortcut so
-- re-running this changes nothing.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS before ADD, seed row guarded by
-- NOT EXISTS.

BEGIN;

ALTER TABLE public.whatsapp_templates
  DROP CONSTRAINT IF EXISTS whatsapp_templates_category_check;

ALTER TABLE public.whatsapp_templates
  ADD CONSTRAINT whatsapp_templates_category_check
  CHECK (category IN ('sales', 'availability', 'service', 'general', 'orders'));

COMMENT ON COLUMN public.whatsapp_templates.category IS
  $c$Which surface offers this template. 'orders' is read by the order screen's send-PDF button; 'sales' stays with quotes.$c$;

-- Starter template. {{נציג}} resolves to the rep the message is sent FROM (the
-- chat's owner, else the order's rep) — never the admin who clicked.
INSERT INTO public.whatsapp_templates (category, title, body, shortcut, sort_order)
SELECT v.category, v.title, v.body, v.shortcut, v.sort_order
FROM (VALUES
  ('orders', 'הזמנה מצורפת',
   'היי {{שם}}, מצורפת ההזמנה שלך מקינג דוד ✅ אני {{נציג}}, ואשמח לעמוד לרשותך לכל שאלה 🙏',
   'הזמנה1', 1)
) AS v(category, title, body, shortcut, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.whatsapp_templates t WHERE t.shortcut = v.shortcut
);

COMMIT;
