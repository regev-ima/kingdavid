-- Returns can now be linked to a customer (not just an order). The New Return
-- screen resolves the customer by phone and stamps customer_id so a standalone
-- return (opened without an order) is still tied to the customer record.
-- Idempotent + ON DELETE SET NULL so losing the customer just orphans the link.

alter table public.return_requests
  add column if not exists customer_id uuid references public.customers(id) on delete set null;

create index if not exists return_requests_customer_id_idx
  on public.return_requests (customer_id)
  where customer_id is not null;

notify pgrst, 'reload schema';
