// Shared 019 (019sms.co.il) SMS helpers, used by both `sendSms` (outbound
// messages) and `smsSettings` (the Settings UI that configures + tests the
// account). Keeping the provider contract in one place means swapping 019 for
// another gateway later is a change to this file alone.

import { createServiceClient } from './supabase.ts';

export const ENDPOINT = 'https://019sms.co.il/api';

export interface Sms019Config {
  token: string;
  username: string;
  sender: string;
  // Where the credentials came from, for diagnostics in the UI:
  //   'db'  – saved from the Settings screen (sms_settings table)
  //   'env' – legacy Supabase project secrets (SMS_019_*)
  //   'none' – not configured
  source: 'db' | 'env' | 'none';
}

// Normalise an Israeli number to 972XXXXXXXXX (no plus, no leading zero),
// which is what the 019 API expects for `destinations.phone`.
export function toInternational(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return '972' + digits.slice(1);
  return digits;
}

// Resolve the active 019 credentials. The DB (set from the Settings UI) wins;
// the old Supabase project secrets are kept as a fallback so existing
// deployments keep working with zero changes. A DB row only counts as
// configured when BOTH token and username are present.
export async function getSms019Config(): Promise<Sms019Config> {
  try {
    const svc = createServiceClient();
    const { data } = await svc
      .from('sms_settings')
      .select('token, username, sender')
      .eq('id', 1)
      .maybeSingle();
    if (data && data.token && data.username) {
      return {
        token: data.token,
        username: data.username,
        sender: data.sender || 'KingDavid',
        source: 'db',
      };
    }
  } catch (_e) {
    // Table may not exist yet (migration not applied) — fall through to env.
  }

  const token = Deno.env.get('SMS_019_TOKEN');
  const username = Deno.env.get('SMS_019_USERNAME');
  const sender = Deno.env.get('SMS_019_SENDER') || 'KingDavid';
  if (token && username) return { token, username, sender, source: 'env' };

  return { token: '', username: '', sender, source: 'none' };
}

export interface Send019Result {
  providerOk: boolean;
  providerStatus: number | string | undefined;
  httpStatus: number;
  result: unknown;
}

// POST a message to 019. Their JSON request is their XML schema expressed as
// JSON: an `sms` envelope carrying the account user, the approved source, the
// destinations list and the message body. 019 returns status 0 on success.
export async function send019Sms(
  cfg: Sms019Config,
  phones: string[],
  message: string,
): Promise<Send019Result> {
  const payload = {
    sms: {
      user: { username: cfg.username },
      source: cfg.sender,
      destinations: { phone: phones.map((p) => ({ _: p })) },
      message,
    },
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${cfg.token}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    result = { raw: text };
  }

  const providerStatus = (result as { status?: number | string })?.status;
  const providerOk = res.ok && (providerStatus === 0 || providerStatus === '0' || providerStatus === undefined);
  return { providerOk, providerStatus, httpStatus: res.status, result };
}
