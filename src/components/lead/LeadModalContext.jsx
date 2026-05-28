import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import LeadDetailsModal from './LeadDetailsModal';

const LeadModalContext = createContext(null);

// Classes applied to the row of the lead that was opened most recently,
// so after closing the overlay the manager can immediately spot where
// they were in a long list. Shared between the LeadManagement table and
// the Leads table so the "you were here" marker looks identical on both.
export const LAST_OPENED_ROW_CLASS = 'bg-primary/[0.06] ring-1 ring-inset ring-primary/30';

export function useLeadModal() {
  const ctx = useContext(LeadModalContext);
  if (!ctx) {
    // Rendered outside the provider (e.g. an isolated test). Degrade to
    // no-ops so callers never crash on a missing provider.
    return { openLead: () => {}, closeLead: () => {}, openLeadId: null, lastOpenedLeadId: null };
  }
  return ctx;
}

export function LeadModalProvider({ children }) {
  const location = useLocation();
  // openLeadId drives the overlay; lastOpenedLeadId persists AFTER close
  // so the originating list keeps the row highlighted ("you were here").
  const [openLeadId, setOpenLeadId] = useState(null);
  const [lastOpenedLeadId, setLastOpenedLeadId] = useState(null);

  const openLead = useCallback((leadId) => {
    if (!leadId) return;
    setOpenLeadId(leadId);
    setLastOpenedLeadId(leadId);
  }, []);

  const closeLead = useCallback(() => setOpenLeadId(null), []);

  // The overlay is rendered ABOVE the router, so a navigation fired from
  // inside the lead (e.g. "deal closed" → /NewOrder) or a sidebar click
  // would otherwise leave the modal floating over the new page. Dismiss
  // it whenever the underlying route actually changes. Opening a lead
  // never touches the URL, so this never fires on open — the list page
  // underneath stays mounted with its scroll, filters and pagination.
  useEffect(() => {
    setOpenLeadId(null);
  }, [location.pathname]);

  return (
    <LeadModalContext.Provider value={{ openLead, closeLead, openLeadId, lastOpenedLeadId }}>
      {children}
      {openLeadId && <LeadDetailsModal leadId={openLeadId} onClose={closeLead} />}
    </LeadModalContext.Provider>
  );
}
