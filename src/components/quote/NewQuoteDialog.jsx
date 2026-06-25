import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import NewQuote from '@/pages/NewQuote';

// Opens the quote-creation form in a popup — the same `asDialog` surface the
// order form uses (NewOrderDialog) — so creating a quote from a list or a lead
// "speaks the same language" as creating an order, instead of navigating away
// to a full page. Mirrors NewOrderDialog exactly.
export default function NewQuoteDialog({ open, onOpenChange, leadId = null, title = 'הצעת מחיר חדשה', onCreated }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl max-h-[90vh] overflow-y-auto"
        dir="rtl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">{title}</DialogTitle>
        </DialogHeader>
        {open && (
          <NewQuote
            asDialog
            dialogLeadId={leadId}
            onDialogClose={(quote) => {
              onOpenChange(false);
              // quote is truthy only on a successful create (null = cancel).
              if (quote?.id) onCreated?.(quote);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
