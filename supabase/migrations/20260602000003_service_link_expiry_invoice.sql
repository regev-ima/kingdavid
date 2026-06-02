-- Service self-service hardening (anti-spam) + invoice attachment.
--
-- Decision: the public intake is TOKEN-ONLY. A customer can only open a ticket
-- through the unique link a rep sends; the link is valid for 24h. So:
--   1. Drop the open, anon-callable ticket-creating RPC added earlier
--      (service_request_create_public) — an anon "create a ticket" endpoint is
--      itself a spam vector even with no UI calling it.
--   2. Add a 24h expiry to the token, enforced in BOTH public RPCs, keyed off
--      public_sent_at (when the rep sent the link), falling back to created_date.
--   3. Add an optional invoice attachment (image or PDF) to the ticket.

-- 1. Remove the open intake RPC ---------------------------------------------
drop function if exists public.service_request_create_public(jsonb);

-- 2. Invoice column ---------------------------------------------------------
alter table public.support_tickets
  add column if not exists invoice_url text;

-- 3a. service_request_get — now reports an `expired` flag --------------------
create or replace function public.service_request_get(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.support_tickets%ROWTYPE;
  v_expired boolean;
begin
  if p_token is null then
    return jsonb_build_object('found', false);
  end if;

  select * into v_row
  from public.support_tickets
  where public_token = p_token
  limit 1;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- Expired = still awaiting the customer AND more than 24h since the link was
  -- sent (fall back to created_date for older rows without public_sent_at).
  v_expired := coalesce(v_row.public_status, 'pending') <> 'submitted'
    and coalesce(v_row.public_sent_at, v_row.created_date) < now() - interval '24 hours';

  return jsonb_build_object(
    'found',          true,
    'ticket_number',  v_row.ticket_number,
    'customer_name',  v_row.customer_name,
    'order_number',   (select order_number from public.orders where id = v_row.order_id),
    'product_name',   v_row.product_name,
    'public_status',  v_row.public_status,
    'already_submitted', coalesce(v_row.public_status = 'submitted', false),
    'expired',        v_expired
  );
end;
$$;

-- 3b. service_request_submit — rejects expired links + stores the invoice ----
create or replace function public.service_request_submit(p_token uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id          uuid;
  v_request_type text;
  v_photos      text[];
  v_invoice     text;
begin
  if p_token is null or p_data is null then
    raise exception 'token and data are required' using errcode = '22023';
  end if;

  -- Only the one pending, non-expired ticket this token points at.
  select id into v_id
  from public.support_tickets
  where public_token = p_token
    and coalesce(public_status, 'pending') <> 'submitted'
    and coalesce(public_sent_at, created_date) >= now() - interval '24 hours'
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found_expired_or_submitted');
  end if;

  v_request_type := nullif(btrim(coalesce(p_data->>'request_type', '')), '');

  -- Photos + invoice: accept only URLs that point at our own uploads bucket.
  v_photos := array(
    select x
    from jsonb_array_elements_text(coalesce(p_data->'photo_urls', '[]'::jsonb)) as x
    where x like '%/storage/v1/object/public/uploads/%'
  );
  v_invoice := nullif(btrim(coalesce(p_data->>'invoice_url', '')), '');
  if v_invoice is not null and v_invoice not like '%/storage/v1/object/public/uploads/%' then
    v_invoice := null;
  end if;

  update public.support_tickets set
    description          = coalesce(nullif(btrim(coalesce(p_data->>'description', '')), ''), description),
    request_type         = coalesce(v_request_type, request_type),
    product_name         = coalesce(nullif(btrim(coalesce(p_data->>'product_name', '')), ''), product_name),
    order_date           = coalesce((p_data->>'order_date')::date, order_date),
    warranty_years       = coalesce((p_data->>'warranty_years')::int, warranty_years),
    complaint_age_months = coalesce((p_data->>'complaint_age_months')::int, complaint_age_months),
    issue_answers        = coalesce(p_data->'issue_answers', issue_answers),
    photo_urls           = case when array_length(v_photos, 1) is null then photo_urls else v_photos end,
    invoice_url          = coalesce(v_invoice, invoice_url),
    contact_preference   = coalesce(nullif(btrim(coalesce(p_data->>'contact_preference', '')), ''), contact_preference),
    opened_by_customer   = true,
    source               = 'customer_self',
    status               = case when status in ('resolved', 'closed') then status else 'open' end,
    public_status        = 'submitted',
    public_submitted_at  = now(),
    updated_date         = now()
  where id = v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.service_request_get(uuid)            from public;
revoke all on function public.service_request_submit(uuid, jsonb)  from public;
grant execute on function public.service_request_get(uuid)           to anon, authenticated;
grant execute on function public.service_request_submit(uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
