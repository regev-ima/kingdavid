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
export default function LeadQuickActions({ currentUser, onLeadCreated }) {
  const [newLead, setNewLead] = useState(null); // null = closed; { phone } = open
  const [showLookup, setShowLookup] = useState(false);
  const [showService, setShowService] = useState(false);

  const openNewLead = (phone = null) => setNewLead({ phone: phone || null });

  return (
    <>
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
