import { useQuery } from '@tanstack/react-query';
import {
  ORDER_AUTOSEND_QUERY_KEY,
  ORDER_AUTOSEND_DEFAULT,
  fetchOrderAutoSendSetting,
} from '@/lib/orderWhatsAppAutoSend';

/**
 * Whether a new order is sent to the customer on WhatsApp by itself.
 *
 * Company policy, not per-record data, so one fetch serves the session. Never
 * errors and never returns undefined — a screen can read `enabled` directly.
 */
export default function useOrderAutoSend() {
  const { data, isLoading } = useQuery({
    queryKey: ORDER_AUTOSEND_QUERY_KEY,
    queryFn: fetchOrderAutoSendSetting,
    staleTime: 5 * 60_000,
    retry: false,
  });

  return { enabled: data ?? ORDER_AUTOSEND_DEFAULT, isLoading };
}
