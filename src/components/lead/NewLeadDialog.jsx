import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import NewLead from '@/pages/NewLead';

// Opens the new-lead form in a popup — the same `asDialog` surface the order and
// quote forms use — so a rep can add a lead from the leads screen without
// leaving it. `phone` seeds the number (e.g. when chaining from a lookup that
// found no match).
export default function NewLeadDialog({ open, onOpenChange, phone = null, onCreated }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-y-auto"
        dir="rtl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">ליד חדש</DialogTitle>
        </DialogHeader>
        {open && (
          <NewLead
            asDialog
            dialogPhone={phone}
            onDialogClose={(lead) => {
              onOpenChange(false);
              if (lead?.id) onCreated?.(lead);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
