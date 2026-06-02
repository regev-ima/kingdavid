-- Public form now collects the customer's name + phone (so a ticket always has
-- contact details even when the rep created the link without them). This:
--   • returns customer_phone from service_request_get (to prefill the form)
--   • persists customer_name / customer_phone in service_request_submit
-- Everything else (24h expiry, invoice, photos) is unchanged from 0003.

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

  v_expired := coalesce(v_row.public_status, 'pending') <> 'submitted'
    and coalesce(v_row.public_sent_at, v_row.created_date) < now() - interval '24 hours';

  return jsonb_build_object(
    'found',          true,
    'ticket_number',  v_row.ticket_number,
    'customer_name',  v_row.customer_name,
    'customer_phone', v_row.customer_phone,
    'order_number',   (select order_number from public.orders where id = v_row.order_id),
    'product_name',   v_row.product_name,
    'public_status',  v_row.public_status,
    'already_submitted', coalesce(v_row.public_status = 'submitted', false),
    'expired',        v_expired
  );
end;
$$;

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
    customer_name        = coalesce(nullif(btrim(coalesce(p_data->>'customer_name', '')), ''), customer_name),
    customer_phone       = coalesce(nullif(btrim(coalesce(p_data->>'customer_phone', '')), ''), customer_phone),
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
