import React, { useState, useEffect, useMemo, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, User, FileText, ShoppingCart, Headphones, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";
import { useLeadModal } from "@/components/lead/LeadModalContext";
import LeadResultCard from '@/components/lead/LeadResultCard';
import { useRepeatEnquiries } from '@/lib/repeatEnquiries';
import { phoneTail as phoneTailOf } from '@/utils/phoneUtils';
import { getUserScope, USER_SCOPES } from "@/lib/rbac";
import { isPhoneShapedQuery } from "@/utils/phoneUtils";

// The previous implementation pulled `.list('-created_date', 200)` for each
// entity and filtered client-side — fine for small datasets, useless once
// leads alone hit 100k+. Now every keystroke (debounced) fires a real
// server-side search via the entities helper's $or + $regex translation.


// The search term SURVIVES closing the dialog. Looking a customer up is rarely
// one lookup: a rep types a phone number, opens the lead, comes back to check
// the order under the same number — and used to find the box empty and have to
// type all ten digits again.
//
// It lives in sessionStorage, not in component state, because component state
// does not survive the trip. Every route in App.jsx renders its OWN
// LayoutWrapper, so navigating from the leads screen to an order unmounts the
// Layout — and GlobalSearch with it — taking any useState with it. That is
// exactly the journey this is meant to survive, so the term has to outlive the
// component. sessionStorage also carries it across a reload and drops it when
// the tab closes, which is the right lifetime for "until I delete it".
const SEARCH_TERM_KEY = 'globalSearchTerm';

function readStoredTerm() {
  try {
    return sessionStorage.getItem(SEARCH_TERM_KEY) || '';
  } catch {
    // Private mode / storage disabled — the search still works, it just forgets.
    return '';
  }
}

function writeStoredTerm(value) {
  try {
    if (value) sessionStorage.setItem(SEARCH_TERM_KEY, value);
    else sessionStorage.removeItem(SEARCH_TERM_KEY);
  } catch {
    /* ignore — see readStoredTerm */
  }
}

export default function GlobalSearch({ isOpen, onClose, user }) {
  const { openLead } = useLeadModal();
  const [query, setQueryState] = useState(readStoredTerm);
  const [debouncedQuery, setDebouncedQuery] = useState(() => readStoredTerm().trim());
  const inputRef = useRef(null);

  const setQuery = (value) => {
    setQueryState(value);
    writeStoredTerm(value);
  };

  // Opening the dialog selects what's there, so typing a different number just
  // replaces it — nobody pays a delete keystroke for the term being kept.
  useEffect(() => {
    if (!isOpen) return undefined;
    // After Radix has finished moving focus into the dialog.
    const t = setTimeout(() => inputRef.current?.select(), 0);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const userScope = getUserScope(user);
  const canSearchLeads   = userScope === USER_SCOPES.ADMIN || userScope === USER_SCOPES.SALES;
  const canSearchOrders  = userScope !== USER_SCOPES.ANON;
  const canSearchQuotes  = userScope === USER_SCOPES.ADMIN || userScope === USER_SCOPES.SALES;
  const canSearchTickets = userScope === USER_SCOPES.ADMIN || userScope === USER_SCOPES.FACTORY;

  const enabled = isOpen && !!user && debouncedQuery.length >= 2;

  // For phone-shaped inputs use the last 9 normalized digits so any stored
  // form ("0537772829", "053-777-2829", "+972537772829") matches the same row.
  // Otherwise fall back to the raw query.
  const phoneTail = useMemo(
    () => (isPhoneShapedQuery(debouncedQuery, 4) ? phoneTailOf(debouncedQuery) : ''),
    [debouncedQuery]
  );

  const PHONE_FIELDS = ['phone', 'phone_2', 'customer_phone', 'customer_phone_2'];
  const buildOrFilter = (fields) => ({
    $or: fields.map((f) => {
      const term = PHONE_FIELDS.includes(f) && phoneTail ? phoneTail : debouncedQuery;
      return { [f]: { $regex: term, $options: 'i' } };
    }),
  });

  // 20, not the 5 the other sections get: leads are what this box is opened
  // for, and a rep scanning for "which of these is my customer" needs the
  // list, not the first handful of whatever sorted to the top.
  const { data: leads = [], isFetching: isLeadsFetching } = useQuery({
    queryKey: ['gs-leads', debouncedQuery],
    enabled: enabled && canSearchLeads,
    staleTime: 60_000,
    // unique_id came along with the איתור ליד screen, which searched it and
    // this box did not. Now that the menu entry opens this dialog, a rep
    // pasting a lead number has to land somewhere.
    queryFn: () => base44.entities.Lead.filter(
      buildOrFilter(['full_name', 'phone', 'phone_2', 'email', 'unique_id']),
      '-created_date',
      20,
    ),
  });

  // The roster turns a rep's email into their name on the result card, and the
  // repeat-enquiry map is what puts "ליד כפול" on it. Both are shared caches
  // the app already fills elsewhere, so neither adds a request in practice.
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: enabled && canSearchLeads,
  });
  const repeatEnquiries = useRepeatEnquiries(leads);

  const { data: orders = [] } = useQuery({
    queryKey: ['gs-orders', debouncedQuery],
    enabled: enabled && canSearchOrders,
    staleTime: 60_000,
    queryFn: () => base44.entities.Order.filter(
      buildOrFilter(['order_number', 'customer_name', 'customer_phone', 'customer_phone_2']),
      '-created_date',
      5,
    ),
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ['gs-quotes', debouncedQuery],
    enabled: enabled && canSearchQuotes,
    staleTime: 60_000,
    queryFn: () => base44.entities.Quote.filter(
      buildOrFilter(['quote_number', 'customer_name']),
      '-created_date',
      5,
    ),
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ['gs-tickets', debouncedQuery],
    enabled: enabled && canSearchTickets,
    staleTime: 60_000,
    queryFn: () => base44.entities.SupportTicket.filter(
      buildOrFilter(['ticket_number', 'customer_name', 'customer_phone']),
      '-created_date',
      5,
    ),
  });

  const totalResults = leads.length + orders.length + quotes.length + tickets.length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      {/* dir="rtl" is not decoration here. A Radix dialog is portaled to
          <body>, which sits outside Layout's dir="rtl" wrapper, and index.html
          declares <html lang="en"> with no direction — so a dialog that does
          not say so itself renders left-to-right. Every other dialog in the app
          sets it; this one was the exception, and it showed the moment the
          lead result stopped being two centred lines of text. */}
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle>חיפוש גלובלי</DialogTitle>
        </DialogHeader>

        <div className="relative mb-4">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder="חפש לפי שם, טלפון, מספר הזמנה..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pr-10 pl-10 text-lg py-6"
            autoFocus
          />
          {query ? (
            <button
              type="button"
              onClick={() => { setQuery(''); setDebouncedQuery(''); inputRef.current?.focus(); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="נקה חיפוש"
              aria-label="נקה חיפוש"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="overflow-y-auto flex-1 space-y-4">
          {debouncedQuery.length >= 2 && totalResults === 0 && !isLeadsFetching && (
            <p className="text-center text-muted-foreground py-4">לא נמצאו תוצאות</p>
          )}

          {/* Offered whenever no LEAD matched, not only when nothing at all
              did. A number with an old order but no lead is exactly when a rep
              is about to type the customer in again by hand. */}
          {enabled && canSearchLeads && !isLeadsFetching && leads.length === 0
            && isPhoneShapedQuery(debouncedQuery) && (
            <div className="flex justify-center py-2">
              <Link
                to={createPageUrl('NewLead') + `?phone=${encodeURIComponent(debouncedQuery)}`}
                onClick={onClose}
              >
                <Button size="sm" className="gap-1.5">
                  <UserPlus className="h-4 w-4" />
                  צור ליד חדש עם הטלפון <span dir="ltr" className="font-semibold">{debouncedQuery}</span>
                </Button>
              </Link>
            </div>
          )}

          {leads.length > 0 && (
            <div>
              <h3 className="font-semibold text-foreground font-heading mb-2 flex items-center gap-2">
                <User className="h-4 w-4" /> לידים
              </h3>
              <div className="space-y-2">
                {leads.map(lead => (
                  <LeadResultCard
                    key={lead.id}
                    lead={lead}
                    users={users}
                    repeatEntry={repeatEnquiries.get(lead.id)}
                    onOpen={() => { onClose(); openLead(lead.id); }}
                  />
                ))}
              </div>
            </div>
          )}

          {orders.length > 0 && (
            <div>
              <h3 className="font-semibold text-foreground font-heading mb-2 flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" /> הזמנות
              </h3>
              <div className="space-y-2">
                {orders.map(order => (
                  <Link
                    key={order.id}
                    to={createPageUrl('OrderDetails') + `?id=${order.id}`}
                    onClick={onClose}
                    className="block p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  >
                    <p className="font-medium">הזמנה #{order.order_number}</p>
                    <p className="text-sm text-muted-foreground">{order.customer_name} • {order.customer_phone}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {quotes.length > 0 && (
            <div>
              <h3 className="font-semibold text-foreground font-heading mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4" /> הצעות מחיר
              </h3>
              <div className="space-y-2">
                {quotes.map(quote => (
                  <Link
                    key={quote.id}
                    to={createPageUrl('QuoteDetails') + `?id=${quote.id}`}
                    onClick={onClose}
                    className="block p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  >
                    <p className="font-medium">הצעה #{quote.quote_number}</p>
                    <p className="text-sm text-muted-foreground">{quote.customer_name}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {tickets.length > 0 && (
            <div>
              <h3 className="font-semibold text-foreground font-heading mb-2 flex items-center gap-2">
                <Headphones className="h-4 w-4" /> קריאות שירות
              </h3>
              <div className="space-y-2">
                {tickets.map(ticket => (
                  <Link
                    key={ticket.id}
                    to={createPageUrl('TicketDetails') + `?id=${ticket.id}`}
                    onClick={onClose}
                    className="block p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  >
                    <p className="font-medium">קריאה #{ticket.ticket_number}</p>
                    <p className="text-sm text-muted-foreground">{ticket.customer_name} • {ticket.category}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
