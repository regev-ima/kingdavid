import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import NewOrderDialog from '@/components/order/NewOrderDialog';
import NewQuoteDialog from '@/components/quote/NewQuoteDialog';
import { useOrderModal } from '@/components/order/OrderModalContext';

// One place that owns "create a new order / new quote as a popup". Any button
// anywhere in the app calls openNewOrder()/openNewQuote() and gets the SAME
// dialog (which reuses the one NewOrder / NewQuote form), so the experience is
// identical everywhere and a change to the form shows up in every entry point.
const CreationModalContext = createContext(null);

export function useCreationModal() {
  const ctx = useContext(CreationModalContext);
  if (!ctx) {
    // Rendered outside the provider — degrade to no-ops so callers never crash.
    return { openNewOrder: () => {}, openNewQuote: () => {} };
  }
  return ctx;
}

export function CreationModalProvider({ children }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { openOrder } = useOrderModal();
  // null when closed; otherwise the seed context ({ leadId, quoteId }).
  const [newOrder, setNewOrder] = useState(null);
  const [newQuote, setNewQuote] = useState(null);

  const openNewOrder = useCallback(
    (opts = {}) => setNewOrder({ leadId: opts.leadId || null, quoteId: opts.quoteId || null }),
    [],
  );
  const openNewQuote = useCallback(
    (opts = {}) => setNewQuote({ leadId: opts.leadId || null }),
    [],
  );

  // A link inside the form (or anywhere) that changes the route should dismiss
  // the popup so it doesn't float over the new page. Opening never touches the
  // URL, so this never fires on open.
  useEffect(() => {
    setNewOrder(null);
    setNewQuote(null);
  }, [location.pathname]);

  return (
    <CreationModalContext.Provider value={{ openNewOrder, openNewQuote }}>
      {children}
      <NewOrderDialog
        open={!!newOrder}
        onOpenChange={(o) => { if (!o) setNewOrder(null); }}
        leadId={newOrder?.leadId}
        quoteId={newOrder?.quoteId}
        onCreated={(order) => {
          queryClient.invalidateQueries({ queryKey: ['orders'] });
          queryClient.invalidateQueries({ queryKey: ['quotes'] });
          // Show the freshly-created order in its popup (e.g. after "המר להזמנה"),
          // instead of dropping the rep back on the quote.
          if (order?.id) openOrder(order.id);
        }}
      />
      <NewQuoteDialog
        open={!!newQuote}
        onOpenChange={(o) => { if (!o) setNewQuote(null); }}
        leadId={newQuote?.leadId}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['quotes'] });
        }}
      />
    </CreationModalContext.Provider>
  );
}
