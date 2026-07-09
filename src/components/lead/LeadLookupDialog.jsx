import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import LeadLookupPanel from '@/components/lead/LeadLookupPanel';

// Popup version of the איתור ליד screen — same search + results (LeadLookupPanel)
// so a rep can find a lead without leaving whatever screen they're on. A result
// opens in the global lead modal and closes this popup; "no match — create this
// number" is delegated to the parent (which opens the new-lead popup).
export default function LeadLookupDialog({ open, onOpenChange, onCreateLead }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">איתור ליד</DialogTitle>
          <p className="text-sm text-muted-foreground">חפש לידים לפי טלפון, שם, או אימייל</p>
        </DialogHeader>
        {open && (
          <LeadLookupPanel
            autoFocus
            onResultOpen={() => onOpenChange(false)}
            onCreateLead={onCreateLead ? (phone) => { onOpenChange(false); onCreateLead(phone); } : null}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
