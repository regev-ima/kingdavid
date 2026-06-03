-- Public, self-initiated service-request intake (תקלה: מרכז שירות).
--
-- The existing public form (service_request_get / service_request_submit) only
-- works when a rep first creates a draft ticket and SMSes the customer a token.
-- This adds the missing piece: a customer can land on /service-request with NO
-- token, type their ORDER NUMBER + contact details, and open a ticket directly.
--
-- The RPC tries to auto-link the new ticket:
--   1. by order number  → order_id + the order's customer_id
--   2. otherwise by phone → an existing customer, else an existing lead
-- If nothing matches, the ticket is still created, just unlinked, so a rep can
-- attach it by hand in the Service Center.
--
-- Anon-callable + SECURITY DEFINER, mirroring website_create_lead (20260415000005)
-- and service_request_submit (20260529000001): the function bypasses RLS but can
-- only ever INSERT one new support_tickets row from a constrained payload.

create or replace function public.service_request_create_public(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name        text;
  v_phone       text;
  v_email       text;
  v_phone_tail  text;          -- last 9 digits, for lenient phone matching
  v_order_in    text;
  v_request_type text;
  v_description text;
  v_photos      text[];
  v_order_id    uuid;
  v_customer_id uuid;
  v_lead_id     uuid;
  v_ticket_num  text;
  v_next_num    int;
  v_id          uuid;
begin
  if p_data is null then
    raise exception 'data is required' using errcode = '22023';
  end if;

  -- ── Normalize inputs ────────────────────────────────────────────────────
  v_name        := nullif(btrim(coalesce(p_data->>'customer_name',  '')), '');
  v_phone       := nullif(btrim(coalesce(p_data->>'customer_phone', '')), '');
  v_email       := nullif(lower(btrim(coalesce(p_data->>'customer_email', ''))), '');
  v_order_in    := nullif(btrim(regexp_replace(coalesce(p_data->>'order_number', ''), '^#', '')), '');
  v_request_type := nullif(btrim(coalesce(p_data->>'request_type', '')), '');
  v_description := nullif(btrim(coalesce(p_data->>'description', '')), '');

  -- ── Validation (kept lenient, like website_create_lead) ──────────────────
  if v_name is null or char_length(v_name) < 2 then
    raise exception 'customer_name must be at least 2 characters' using errcode = '22023';
  end if;
  if v_phone is null or regexp_replace(v_phone, '\D', '', 'g') !~ '^\d{9,12}$' then
    raise exception 'customer_phone must be a valid phone number' using errcode = '22023';
  end if;
  if v_description is null then
    raise exception 'description is required' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'email is not valid' using errcode = '22023';
  end if;

  v_phone_tail := right(regexp_replace(v_phone, '\D', '', 'g'), 9);

  -- Photos: accept only URLs that point at our own uploads bucket.
  v_photos := array(
    select x
    from jsonb_array_elements_text(coalesce(p_data->'photo_urls', '[]'::jsonb)) as x
    where x like '%/storage/v1/object/public/uploads/%'
  );

  -- ── Auto-link #1: by order number ────────────────────────────────────────
  if v_order_in is not null then
    select o.id, o.customer_id
      into v_order_id, v_customer_id
    from public.orders o
    where lower(btrim(o.order_number)) = lower(v_order_in)
    order by o.created_date desc nulls last
    limit 1;
  end if;

  -- ── Auto-link #2: by phone (customer, then lead) when no order matched ────
  if v_customer_id is null then
    select c.id into v_customer_id
    from public.customers c
    where right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9) = v_phone_tail
      and v_phone_tail <> ''
    order by c.created_date desc nulls last
    limit 1;
  end if;

  if v_customer_id is null and v_lead_id is null then
    select l.id into v_lead_id
    from public.leads l
    where right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 9) = v_phone_tail
      and v_phone_tail <> ''
    order by l.created_date desc nulls last
    limit 1;
  end if;

  -- ── Next ticket number (TKT#### sequence) ────────────────────────────────
  select coalesce(max((regexp_replace(ticket_number, '\D', '', 'g'))::int), 1000)
    into v_next_num
  from public.support_tickets
  where ticket_number ~ '^TKT\d+$';
  v_ticket_num := 'TKT' || (v_next_num + 1)::text;

  -- ── Insert the ticket ────────────────────────────────────────────────────
  insert into public.support_tickets (
    ticket_number,
    order_id, customer_id, lead_id,
    customer_name, customer_phone, customer_email,
    subject, description,
    category, request_type,
    priority, status,
    source, opened_by_customer,
    order_date, warranty_years, complaint_age_months,
    product_name, issue_answers, photo_urls, contact_preference,
    public_status, public_submitted_at,
    sla_due_date,
    created_date, updated_date
  )
  values (
    v_ticket_num,
    v_order_id, v_customer_id, v_lead_id,
    v_name, v_phone, v_email,
    coalesce(left(v_description, 80), 'פניית שירות'),
    v_description,
    case v_request_type when 'trial_30d' then 'trial' when 'warranty' then 'warranty' else 'other' end,
    v_request_type,
    'medium', 'open',
    'customer_self', true,
    (p_data->>'order_date')::date,
    (p_data->>'warranty_years')::int,
    (p_data->>'complaint_age_months')::int,
    nullif(btrim(coalesce(p_data->>'product_name', '')), ''),
    coalesce(p_data->'issue_answers', '{}'::jsonb),
    v_photos,
    nullif(btrim(coalesce(p_data->>'contact_preference', '')), ''),
    'submitted', now(),
    now() + interval '48 hours',
    now(), now()
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok',              true,
    'ticket_number',   v_ticket_num,
    'order_linked',    (v_order_id is not null),
    'customer_linked', (v_customer_id is not null or v_lead_id is not null)
  );
end;
$$;

revoke all on function public.service_request_create_public(jsonb) from public;
grant execute on function public.service_request_create_public(jsonb) to anon, authenticated;

-- Reload PostgREST schema cache so the new RPC is callable immediately.
notify pgrst, 'reload schema';
