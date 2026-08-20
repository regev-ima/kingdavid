import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { useLeadModal } from '@/components/lead/LeadModalContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import LeadResultCard from '@/components/lead/LeadResultCard';
import { useRepeatEnquiries } from '@/lib/repeatEnquiries';
import { Search, UserPlus } from 'lucide-react';
import { isPhoneShapedQuery as isPhoneShapedQueryFor } from '@/utils/phoneUtils';

// Treat anything with 5+ digits (ignoring formatting chars) as a phone-
// shaped query, otherwise search the name/email fields. Lower bound than the
// 7-digit default so a partial number still matches while typing.
const isPhoneShapedQuery = (s) => isPhoneShapedQueryFor(s, 5);
function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * The lead search field + live results. Shared by the full-page איתור ליד
 * screen (LeadLookup) and the popup (LeadLookupDialog) so both behave
 * identically. Results open in the global lead modal via useLeadModal.
 *
 * Props:
 *   autoFocus     — focus the search field on mount (default true)
 *   onCreateLead  — (phone) => void; overrides the "create a lead with this
 *                   number" action (the popup opens NewLeadDialog instead of
 *                   navigating). Falls back to navigating to /NewLead.
 *   onResultOpen  — called after a result is opened (lets the popup close
 *                   itself so the lead modal isn't stacked on top of it).
 */
export default function LeadLookupPanel({ autoFocus = true, onCreateLead = null, onResultOpen = null }) {
  const navigate = useNavigate();
  const { openLead } = useLeadModal();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const inputRef = useRef(null);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  const { data: results = [], isLoading, isFetching } = useQuery({
    queryKey: ['leadLookup', debouncedQuery],
    enabled: debouncedQuery.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const safe = debouncedQuery.replace(/[",()]/g, '');
      let q = supabase
        .from('leads')
        .select('id, full_name, phone, email, status, source, rep1, rep2, pending_rep_email, contact_id, unique_id, created_date, effective_sort_date, utm_source, utm_campaign')
        .order('effective_sort_date', { ascending: false, nullsFirst: false })
        .limit(30);
      if (isPhoneShapedQuery(safe)) {
        const digits = safe.replace(/\D/g, '');
        q = q.ilike('phone', `%${digits}%`);
      } else {
        q = q.or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%,unique_id.ilike.%${safe}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  // "ליד כפול" — which of these results belong to someone who is in the system
  // more than once. Looking a person up is exactly when a rep needs to know
  // that: the answer to "is this a new customer?" is on this screen or nowhere.
  const repeatEnquiries = useRepeatEnquiries(results);

  // Only used to turn the rep's email on a result into their name. Same
  // `['users']` key the rest of the app uses, so this shares the cached roster
  // instead of adding a request. `retry: false` — if it fails the card falls
  // back to the email (getRepDisplayName's own fallback) rather than blocking.
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const hasQuery = debouncedQuery.length >= 2;
  const showEmpty = hasQuery && !isLoading && results.length === 0;

  const handleOpen = (id) => {
    openLead(id);
    onResultOpen?.();
  };

  const handleCreateLead = () => {
    const phone = debouncedQuery.replace(/\D/g, '');
    if (onCreateLead) onCreateLead(phone);
    else navigate(createPageUrl('NewLead') + `?phone=${encodeURIComponent(phone)}`);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
            placeholder="הקלד מספר טלפון, שם, או אימייל..."
            className="h-14 pr-12 pl-4 text-lg rounded-full shadow-lg focus-visible:shadow-xl transition-shadow"
            aria-label="חיפוש ליד"
            inputMode="search"
            autoComplete="off"
          />
          {query ? (
            <button
              type="button"
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 flex items-center justify-center transition-colors"
              aria-label="נקה חיפוש"
            >
              ×
            </button>
          ) : null}
        </div>

        {hasQuery ? (
          <p className="text-[11px] text-center text-muted-foreground">
            {isFetching ? 'מחפש...' : `${results.length} תוצאות מהירות`}
          </p>
        ) : (
          <p className="text-[11px] text-center text-muted-foreground/80">
            כדי לחפש מהר — הזן לפחות 5 ספרות מתוך מספר הטלפון
          </p>
        )}
      </div>

      <div className="space-y-2">
        {!hasQuery ? null : isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
          </div>
        ) : showEmpty ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center space-y-3 shadow-card">
            <p className="text-sm text-muted-foreground">לא נמצאו לידים שתואמים את "<span className="font-semibold text-foreground" dir="ltr">{debouncedQuery}</span>"</p>
            {isPhoneShapedQuery(debouncedQuery) ? (
              <Button size="sm" onClick={handleCreateLead} className="gap-1.5">
                <UserPlus className="h-4 w-4" />
                צור ליד חדש עם טלפון זה
              </Button>
            ) : null}
          </div>
        ) : (
          results.map((lead) => (
            <LeadResultCard
              key={lead.id}
              lead={lead}
              users={users}
              repeatEntry={repeatEnquiries.get(lead.id)}
              onOpen={() => handleOpen(lead.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
