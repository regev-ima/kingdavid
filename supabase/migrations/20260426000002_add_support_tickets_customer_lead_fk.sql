-- /NewTicket exposes a phone-based lookup that pre-fills the form from a
-- matching customer or lead and, ideally, stamps a hard FK on the ticket so
-- it can be linked back to that record from /TicketDetails or reporting.
--
-- The deployed support_tickets schema doesn't have those FK columns yet, so
-- the client currently strips customer_id / lead_id from the insert payload
-- to avoid PGRST204. Once this migration runs, the client will keep sending
-- them (it already does) and they'll be persisted.
--
-- ON DELETE SET NULL — losing the customer / lead row shouldn't delete the
-- ticket, just orphan the link.

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_id     uuid REFERENCES public.leads(id)     ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS support_tickets_customer_id_idx
  ON public.support_tickets (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS support_tickets_lead_id_idx
  ON public.support_tickets (lead_id)
  WHERE lead_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
