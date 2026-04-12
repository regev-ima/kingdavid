import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useImpersonation } from '@/components/shared/ImpersonationContext';

export default function useEffectiveCurrentUser(enabled = true) {
  const { getEffectiveUser, isImpersonating } = useImpersonation();

  const { data: user = null, isLoading, error } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    enabled,
    staleTime: 300000,
  });

  const effectiveUser = useMemo(
    () => getEffectiveUser(user),
    [getEffectiveUser, isImpersonating, user]
  );

  return {
    user,
    effectiveUser,
    isLoading,
    error,
    isImpersonating,
  };
}
