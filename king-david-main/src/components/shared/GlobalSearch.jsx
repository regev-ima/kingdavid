import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, User, FileText, ShoppingCart, Headphones } from "lucide-react";
import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";
import {
  buildLeadsById,
  filterLeadsForUser,
  filterOrdersForUser,
  filterQuotesForUser,
  filterTicketsForUser,
  getUserScope,
  USER_SCOPES,
} from "@/lib/rbac";

export default function GlobalSearch({ isOpen, onClose, user }) {
  const [query, setQuery] = useState('');
  const userScope = getUserScope(user);
  const canSearchLeads = userScope === USER_SCOPES.ADMIN || userScope === USER_SCOPES.SALES;
  const canSearchOrders = userScope !== USER_SCOPES.ANON;
  const canSearchQuotes = userScope === USER_SCOPES.ADMIN || userScope === USER_SCOPES.SALES;
  const canSearchTickets = userScope === USER_SCOPES.ADMIN || userScope === USER_SCOPES.FACTORY;

  const { data: allLeads = [] } = useQuery({
    queryKey: ['search-leads'],
    queryFn: () => base44.entities.Lead.list('-created_date', 200),
    staleTime: 120000,
    enabled: isOpen && !!user && canSearchLeads,
  });

  const { data: allOrders = [] } = useQuery({
    queryKey: ['search-orders'],
    queryFn: () => base44.entities.Order.list('-created_date', 200),
    staleTime: 120000,
    enabled: isOpen && !!user && canSearchOrders,
  });

  const { data: allQuotes = [] } = useQuery({
    queryKey: ['search-quotes'],
    queryFn: () => base44.entities.Quote.list('-created_date', 200),
    staleTime: 120000,
    enabled: isOpen && !!user && canSearchQuotes,
  });

  const { data: allTickets = [] } = useQuery({
    queryKey: ['search-tickets'],
    queryFn: () => base44.entities.SupportTicket.list('-created_date', 200),
    staleTime: 120000,
    enabled: isOpen && !!user && canSearchTickets,
  });

  const results = useMemo(() => {
    if (query.length < 2) {
      return { leads: [], orders: [], quotes: [], tickets: [] };
    }
    const searchLower = query.toLowerCase();
    const leadsById = buildLeadsById(allLeads);
    const scopedLeads = filterLeadsForUser(user, allLeads);
    const scopedOrders = filterOrdersForUser(user, allOrders);
    const scopedQuotes = filterQuotesForUser(user, allQuotes, leadsById);
    const scopedTickets = filterTicketsForUser(user, allTickets);

    return {
      leads: scopedLeads.filter(l =>
        l.full_name?.toLowerCase().includes(searchLower) ||
        l.phone?.includes(query) ||
        l.email?.toLowerCase().includes(searchLower)
      ).slice(0, 5),
      orders: scopedOrders.filter(o =>
        o.order_number?.toLowerCase().includes(searchLower) ||
        o.customer_name?.toLowerCase().includes(searchLower) ||
        o.customer_phone?.includes(query)
      ).slice(0, 5),
      quotes: scopedQuotes.filter(q =>
        q.quote_number?.toLowerCase().includes(searchLower) ||
        q.customer_name?.toLowerCase().includes(searchLower)
      ).slice(0, 5),
      tickets: scopedTickets.filter(t =>
        t.ticket_number?.toLowerCase().includes(searchLower) ||
        t.customer_name?.toLowerCase().includes(searchLower) ||
        t.customer_phone?.includes(query)
      ).slice(0, 5),
    };
  }, [query, user, allLeads, allOrders, allQuotes, allTickets]);

  const totalResults = Object.values(results).flat().length;

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
          {query.length >= 2 && totalResults === 0 && (
            <p className="text-center text-muted-foreground py-4">לא נמצאו תוצאות</p>
          )}

          {results.leads.length > 0 && (
            <div>
              <h3 className="font-semibold text-foreground font-heading mb-2 flex items-center gap-2">
                <User className="h-4 w-4" /> לידים
              </h3>
              <div className="space-y-2">
                {results.leads.map(lead => (
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

          {results.orders.length > 0 && (
            <div>
              <h3 className="font-semibold text-foreground font-heading mb-2 flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" /> הזמנות
              </h3>
              <div className="space-y-2">
                {results.orders.map(order => (
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

          {results.quotes.length > 0 && (
            <div>
              <h3 className="font-semibold text-foreground font-heading mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4" /> הצעות מחיר
              </h3>
              <div className="space-y-2">
                {results.quotes.map(quote => (
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

          {results.tickets.length > 0 && (
            <div>
              <h3 className="font-semibold text-foreground font-heading mb-2 flex items-center gap-2">
                <Headphones className="h-4 w-4" /> קריאות שירות
              </h3>
              <div className="space-y-2">
                {results.tickets.map(ticket => (
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
