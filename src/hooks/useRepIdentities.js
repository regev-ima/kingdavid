import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { buildRepIdentities } from '@/lib/repIdentity';

/**
 * The team's colour/icon assignment, keyed by email (and by name as a
 * fallback). Uniqueness is a property of the whole roster, so this loads it —
 * on the same `['users']` query key half the app already uses, which means the
 * pages that fetch users share one request rather than adding another.
 *
 * `retry: false` because a caller can render before the session is ready
 * (the avatar in the top bar, for instance); a failed load falls through to
 * the hashed fallback instead of retry-storming.
 */
export function useRepIdentities() {
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return useMemo(() => buildRepIdentities(users), [users]);
}

export default useRepIdentities;
