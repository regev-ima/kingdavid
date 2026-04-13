import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Create a Supabase client with service role (bypasses RLS).
 * Use for server-side operations in Edge Functions.
 */
export function createServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

/**
 * Create a Supabase client scoped to the requesting user (respects RLS).
 */
export function createUserClient(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
}

/**
 * Get the authenticated user from the request, or throw 401.
 */
export async function getUser(req: Request) {
  const client = createUserClient(req);
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new Error('Unauthorized');

  const { data: profile } = await createServiceClient()
    .from('users')
    .select('*')
    .eq('auth_id', user.id)
    .single();

  return profile;
}

/**
 * Standard CORS headers for Edge Functions.
 */
const ALLOWED_ORIGINS = [
  'https://kingdavid-one.vercel.app',
  'https://king.imagick.ai',
  'http://localhost:5173',
];

export function getCorsHeaders(req?: Request) {
  const origin = req?.headers?.get('origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

// Keep backwards compat
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
