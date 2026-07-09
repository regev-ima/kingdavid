import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import QuoteDetailsModal from './QuoteDetailsModal';

// Opening a quote as a popup over the list (no navigation), mirroring
// OrderModalContext. Any list calls openQuote(id) instead of navigating, so the
// URL never changes and the list stays mounted with its scroll/filters.
const QuoteModalContext = createContext(null);

export function useQuoteModal() {
  const ctx = useContext(QuoteModalContext);
  if (!ctx) {
    return { openQuote: () => {}, closeQuote: () => {}, openQuoteId: null };
  }
  return ctx;
}

export function QuoteModalProvider({ children }) {
  const location = useLocation();
  const [openQuoteId, setOpenQuoteId] = useState(null);

  const openQuote = useCallback((quoteId) => {
    if (quoteId) setOpenQuoteId(quoteId);
  }, []);

  const closeQuote = useCallback(() => setOpenQuoteId(null), []);

  // A link fired from inside the quote would leave the popup floating over the
  // new page; dismiss it whenever the underlying route actually changes.
  // Opening never touches the URL, so this never fires on open.
  useEffect(() => {
    setOpenQuoteId(null);
  }, [location.pathname]);

  return (
    <QuoteModalContext.Provider value={{ openQuote, closeQuote, openQuoteId }}>
      {children}
      {openQuoteId && <QuoteDetailsModal quoteId={openQuoteId} onClose={closeQuote} />}
    </QuoteModalContext.Provider>
  );
}
