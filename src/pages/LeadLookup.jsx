import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { createPageUrl } from '@/utils';
import { useLeadModal } from '@/components/lead/LeadModalContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/shared/StatusBadge';
import { Search, Phone, ArrowLeft, UserPlus, Users } from 'lucide-react';
import { SOURCE_LABELS } from '@/constants/leadOptions';

// Treat anything with 5+ digits (ignoring formatting chars) as a phone-
// shaped query, otherwise search the name/email fields. Both branches
// use case-insensitive substring match server-side so the user gets
// "find as you type" behaviour without scanning every column for free
// text on every keystroke.
function isPhoneShapedQuery(s) {
  const digits = String(s || '').replace(/\D/g, '');
  return digits.length >= 5;
}
function formatPhone(p) {
  const cleaned = String(p || '').replace(/\D/g, '');
  if (cleaned.length === 10) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  return p || '';
}

// Light debounce so the query doesn't fire on every keystroke. 300 ms
// is the sweet spot between feeling responsive and not slamming the
// API with N requests for a 7-digit phone number.
function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function LeadLookup() {
  const navigate = useNavigate();
  const { openLead } = useLeadModal();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const inputRef = useRef(null);

  // Auto-focus the search bar on mount so the rep can land on the page
  // and start typing immediately — like Google. Esc clears the field
  // without unfocusing, also like Google.
  useEffect(() => { inputRef.current?.focus(); }, []);

  const { data: results = [], isLoading, isFetching } = useQuery({
    queryKey: ['leadLookup', debouncedQuery],
    enabled: debouncedQuery.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      // Hand-built .or() clause keeps the URL shape predictable. ilike
      // wildcards are %-anchored so any-substring matches — typing
      // "0524" matches "+972-052-4..." once the digits are normalised
      // through the phone-shaped branch below.
      const safe = debouncedQuery.replace(/[",()]/g, '');
      let q = supabase
        .from('leads')
        .select('id, full_name, phone, email, status, source, rep1, rep2, pending_rep_email, unique_id, created_date, effective_sort_date, utm_source, utm_campaign')
        .order('effective_sort_date', { ascending: false, nullsFirst: false })
        .limit(30);
      if (isPhoneShapedQuery(safe)) {
        // For phone queries strip non-digits, then ilike-substring on
        // phone only — names with the same string of digits aren't a
        // realistic confound, and keeping the .or() narrow keeps the
        // query fast on a 100k-row leads table.
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

  const hasQuery = debouncedQuery.length >= 2;
  const showEmpty = hasQuery && !isLoading && results.length === 0;

  return (
    <div className="min-h-[calc(100vh-7rem)] flex flex-col items-center pt-12 sm:pt-20 px-4" dir="rtl">
      {/* Hero search */}
      <div className="w-full max-w-2xl space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">איתור ליד</h1>
          <p className="text-sm text-muted-foreground">חפש לידים במאגר לפי מספר טלפון, שם, או אימייל</p>
        </div>

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

      {/* Results */}
      <div className="w-full max-w-3xl mt-6 space-y-2">
        {!hasQuery ? null : isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
          </div>
        ) : showEmpty ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center space-y-3 shadow-card">
            <p className="text-sm text-muted-foreground">לא נמצאו לידים שתואמים את "<span className="font-semibold text-foreground" dir="ltr">{debouncedQuery}</span>"</p>
            {isPhoneShapedQuery(debouncedQuery) ? (
              <Button
                size="sm"
                onClick={() => navigate(createPageUrl('NewLead') + `?phone=${encodeURIComponent(debouncedQuery.replace(/\D/g, ''))}`)}
                className="gap-1.5"
              >
                <UserPlus className="h-4 w-4" />
                צור ליד חדש עם טלפון זה
              </Button>
            ) : null}
          </div>
        ) : (
          results.map((lead) => (
            <LeadResultCard key={lead.id} lead={lead} onOpen={() => openLead(lead.id)} />
          ))
        )}
      </div>
    </div>
  );
}

function LeadResultCard({ lead, onOpen }) {
  const navigate = useNavigate();
  // Owner attribution stays minimal — the rep is looking up a lead they
  // don't own, so the question is really "who has this?" Show the
  // primary rep first, then any secondary / pending rep flags.
  const ownerEmail = lead.rep1 || lead.pending_rep_email || lead.rep2 || null;
  const sourceLabel = lead.source ? (SOURCE_LABELS[lead.source] || lead.source) : null;
  const callHref = lead.phone ? `tel:${lead.phone}` : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-right rounded-xl border border-border bg-card p-4 shadow-card hover:shadow-card-hover hover:border-primary/40 transition-all group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-base font-bold text-foreground truncate">{lead.full_name || 'לא צוין שם'}</p>
            {lead.status ? <StatusBadge status={lead.status} /> : null}
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
            {lead.phone ? (
              <span className="inline-flex items-center gap-1" dir="ltr">
                <Phone className="h-3 w-3" />
                {formatPhone(lead.phone)}
              </span>
            ) : null}
            {lead.email ? <span className="truncate max-w-[200px]">{lead.email}</span> : null}
            {sourceLabel ? (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                {sourceLabel}
              </span>
            ) : null}
          </div>
          {ownerEmail ? (
            <div className="mt-2 text-[11px] text-muted-foreground inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              <span>נציג מטפל: <span className="font-medium text-foreground">{ownerEmail}</span></span>
              {lead.pending_rep_email && lead.rep1 ? (
                <span className="text-amber-700">· ממתין לשיוך</span>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-amber-700 inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              לא משויך לנציג
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {callHref ? (
            <a
              href={callHref}
              onClick={(e) => e.stopPropagation()}
              className="h-8 w-8 rounded-full bg-emerald-100 hover:bg-emerald-200 flex items-center justify-center transition-colors"
              title="התקשר"
              aria-label="התקשר"
            >
              <Phone className="h-4 w-4 text-emerald-700" />
            </a>
          ) : null}
          <ArrowLeft className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:-translate-x-1 transition-all" aria-hidden="true" />
        </div>
      </div>
    </button>
  );
}
