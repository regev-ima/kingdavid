import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useImpersonation } from '@/components/shared/ImpersonationContext';

export default function useEffectiveCurrentUser() {
  const { getEffectiveUser } = useImpersonation();
  const { data: user, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    staleTime: 300000,
  });
  const effectiveUser = getEffectiveUser(user);
  return { effectiveUser, isLoading, rawUser: user };
}