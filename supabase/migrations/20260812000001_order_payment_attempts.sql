-- Every card attempt on an order, not just the ones that worked.
--
-- Until now a declined card left no trace anywhere. hyp-notify saw the
-- non-zero CCode and returned early ("nothing to apply"); hyp-verify answered
-- {verified:false} and wrote nothing. Both functions only ever touched
-- orders.payments, and that array is money that landed. So the rep got an
-- error in the payment window, the window closed, and the entire event was
-- gone — no code, no time, no card, nothing to look up afterwards. "I get an
-- error and I don't know whether the card went through" was literally true:
-- the system did not know either.
--
-- This column is the record of the attempt, kept deliberately separate from
-- `payments`. Mixing the two would be a data bug, not a shortcut: payments is
-- summed in half a dozen places to decide what an order still owes
-- (calcPaymentStatus in OrderDetails, hyp-verify, hyp-notify, hyp-sign's
-- remaining-balance guard), and a failed attempt carrying an amount would make
-- an unpaid order look settled.
--
-- Shape of each element, written by hyp-verify and hyp-notify:
--   {
--     hyp_transaction_id: text,   -- Hyp's Id; the idempotency key
--     hyp_attempt_id:     text,   -- our "<order_uuid>__<base36>" from hyp-sign
--     status:             text,   -- 'declined' | 'unknown'
--     ccode:              text,   -- Hyp's error code, verbatim
--     amount:             numeric,-- what we tried to charge
--     source:             text,   -- 'hyp-notify' | 'hyp-verify'
--     recorded_at:        timestamptz,
--     recorded_by:        text,
--     hyp_params:         jsonb   -- everything Hyp sent, untouched
--   }
--
-- hyp_params is stored whole on purpose. We do not have Hyp's table of CCode
-- meanings, so rather than guess at a translation we keep the raw reply: when
-- the meanings arrive, every past attempt can be read correctly without
-- needing to have been captured live.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_attempts jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.orders.payment_attempts IS
  'Failed / unresolved Hyp charge attempts. Never summed — orders.payments is the money that landed.';

-- Orders carrying an unresolved attempt are the ones worth chasing: somebody
-- tried to charge, and nobody knows how it ended.
CREATE INDEX IF NOT EXISTS idx_orders_payment_attempts
  ON public.orders USING gin (payment_attempts);
