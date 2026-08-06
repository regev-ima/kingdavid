import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resolveDocumentTerms } from '@/constants/documentTerms';
import { DOCUMENT_TERMS_QUERY_KEY, fetchDocumentTermsSetting } from '@/lib/documentTermsSettings';

/**
 * The company-wide legal texts a document falls back to: whatever an admin
 * saved in הגדרות ← טקסטים ותנאים, else the text in code.
 *
 * Never errors and never returns blanks — `defaults` is always three usable
 * strings, so a screen can render the terms card unconditionally.
 */
export default function useDocumentTermsDefaults() {
  const { data, isLoading } = useQuery({
    queryKey: DOCUMENT_TERMS_QUERY_KEY,
    queryFn: fetchDocumentTermsSetting,
    // Company policy, not per-record data: one fetch serves every quote and
    // order screen the user opens.
    staleTime: 5 * 60_000,
    retry: false,
  });

  const defaults = useMemo(() => resolveDocumentTerms(data?.value, null), [data]);

  return {
    defaults,
    updatedDate: data?.updated_date || null,
    updatedBy: data?.updated_by || null,
    isLoading,
    // True when the texts are the ones in code — nothing was saved in Settings
    // (or the app_settings migration hasn't been applied yet).
    isUsingCodeDefaults: !data,
  };
}
