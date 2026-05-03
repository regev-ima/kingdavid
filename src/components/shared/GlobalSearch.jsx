import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, User, FileText, ShoppingCart, Headphones, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";
import { getUserScope, USER_SCOPES, filterLeadsForUser } from "@/lib/rbac";
import { isPhoneShapedQuery } from "@/utils/phoneUtils";

// The previous implementation pulled `.list('-created_date', 200)` for each
// entity and filtered client-side — fine for small datasets, useless once
// leads alone hit 100k+. Now every keystroke (debounced) fires a real
// server-side search via the entities helper's $or + $regex translation.

function normalizePhoneForSearch(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('972') && digits.length >= 11) return '0' + digits.slice(3);
  return digits;
}

export default function GlobalSearch({ isOpen, onClose, user }) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Reset the input every time the dialog re-opens so an old term doesn't
  // resurface stale results.
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setDebouncedQuery('');
    }
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
  const phoneTail = useMemo(() => {
    const norm = normalizePhoneForSearch(debouncedQuery);
    return norm.length >= 4 ? norm.slice(-9) : '';
  }, [debouncedQuery]);

  const buildOrFilter = (fields) => ({
    $or: fields.map((f) => {
      const isPhoneField = f === 'phone' || f === 'customer_phone';
      const term = isPhoneField && phoneTail ? phoneTail : debouncedQuery;
      return { [f]: { $regex: term, $options: 'i' } };
    }),
  });

  const { data: leadsRaw = [] } = useQuery({
    queryKey: ['gs-leads', debouncedQuery],
    enabled: enabled && canSearchLeads,
    staleTime: 60_000,
    queryFn: () => base44.entities.Lead.filter(
      buildOrFilter(['full_name', 'phone', 'email']),
      '-created_date',
      5,
    ),
  });

  // Reps must only see leads assigned to them — admins see everything.
  const leads = useMemo(() => filterLeadsForUser(user, leadsRaw), [user, leadsRaw]);

  const { data: orders = [] } = useQuery({
    queryKey: ['gs-orders', debouncedQuery],
    enabled: enabled && canSearchOrders,
    staleTime: 60_000,
    queryFn: () => base44.entities.Order.filter(
      buildOrFilter(['order_number', 'customer_name', 'customer_phone']),
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
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>חיפוש גלובלי</DialogTitle>
        </DialogHeader>

        <div className="relative mb-4">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="חפש לפי שם, טלפון, מספר הזמנה..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pr-10 text-lg py-6"
            autoFocus
          />
        </div>

        <div className="overflow-y-auto flex-1 space-y-4">
          {debouncedQuery.length >= 2 && totalResults === 0 && (
            <div className="flex flex-col items-center gap-3 py-4">
              <p className="text-center text-muted-foreground">לא נמצאו תוצאות</p>
              {canSearchLeads && isPhoneShapedQuery(debouncedQuery) && (
                <Link
                  to={createPageUrl('NewLead') + `?phone=${encodeURIComponent(debouncedQuery)}`}
                  onClick={onClose}
                >
                  <Button size="sm" className="gap-1.5">
                    <UserPlus className="h-4 w-4" />
                    צור ליד חדש עם הטלפון <span dir="ltr" className="font-semibold">{debouncedQuery}</span>
                  </Button>
                </Link>
              )}
            </div>
          )}

          {leads.length > 0 && (
            <div>
              <h3 className="font-semibold text-foreground font-heading mb-2 flex items-center gap-2">
                <User className="h-4 w-4" /> לידים
              </h3>
              <div className="space-y-2">
                {leads.map(lead => (
                  <Link
                    key={lead.id}
                    to={createPageUrl('LeadDetails') + `?id=${lead.id}`}
                    onClick={onClose}
                    className="block p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  >
                    <p className="font-medium">{lead.full_name}</p>
                    <p className="text-sm text-muted-foreground">{lead.phone} • {lead.email}</p>
                  </Link>
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
