import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { UserPlus, Search, Headphones } from 'lucide-react';
import NewLeadDialog from '@/components/lead/NewLeadDialog';
import LeadLookupDialog from '@/components/lead/LeadLookupDialog';
import OpenServiceTicketDialog from '@/components/service/OpenServiceTicketDialog';

// A row of quick actions that all open as popups so the rep never has to leave
// the screen: find a lead, open a service inquiry (the same dialog used across
// the app), and create a new lead. Lookup → "no match" chains straight into the
// new-lead popup with the typed number pre-filled.
// `toolbar` renders the same three actions the way the leads/tasks screen's
// top bar shows them: the lookup as a search field (that's what a manager
// reads it as — "חיפוש ליד..."), service calls in green, and a taller primary
// "ליד חדש". Same dialogs, same behaviour; only the chrome differs.
export default function LeadQuickActions({ currentUser, onLeadCreated, toolbar = false }) {
  const [newLead, setNewLead] = useState(null); // null = closed; { phone } = open
  const [showLookup, setShowLookup] = useState(false);
  const [showService, setShowService] = useState(false);

  const openNewLead = (phone = null) => setNewLead({ phone: phone || null });

  return (
    <>
      {toolbar ? (
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => setShowLookup(true)}
            className="h-11 w-44 rounded-xl border border-border bg-card px-3.5 flex items-center justify-between gap-2 text-sm text-muted-foreground hover:bg-muted/60 transition-colors"
          >
            חיפוש ליד...
            <Search className="h-4 w-4 flex-none" />
          </button>
          <Button
            onClick={() => setShowService(true)}
            variant="outline"
            className="h-11 rounded-xl gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
          >
            <Headphones className="h-4 w-4" /> שיחות שירות
          </Button>
          <Button onClick={() => openNewLead()} className="h-11 rounded-xl gap-2 px-5">
            <UserPlus className="h-4 w-4" /> ליד חדש
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => setShowLookup(true)} variant="outline" size="sm" className="gap-1.5">
            <Search className="h-4 w-4" /> איתור ליד
          </Button>
          <Button
            onClick={() => setShowService(true)}
            variant="outline"
            size="sm"
            className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
          >
            <Headphones className="h-4 w-4" /> פניית שירות
          </Button>
          <Button onClick={() => openNewLead()} size="sm" className="gap-1.5">
            <UserPlus className="h-4 w-4" /> ליד חדש
          </Button>
        </div>
      )}

      <NewLeadDialog
        open={!!newLead}
        onOpenChange={(o) => { if (!o) setNewLead(null); }}
        phone={newLead?.phone}
        onCreated={() => onLeadCreated?.()}
      />

      <LeadLookupDialog
        open={showLookup}
        onOpenChange={setShowLookup}
        onCreateLead={(phone) => openNewLead(phone)}
      />

      <OpenServiceTicketDialog
        open={showService}
        onOpenChange={setShowService}
        currentUser={currentUser}
      />
    </>
  );
}
