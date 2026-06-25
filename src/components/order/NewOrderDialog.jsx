import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import NewOrder from '@/pages/NewOrder';

// Opens the order-creation form in a popup — the same `asDialog` surface the
// lead screen already uses (LeadDetails) — so creating an order from the Orders
// list "speaks the same language" as creating one from a lead, instead of
// navigating away to a full page.
export default function NewOrderDialog({ open, onOpenChange, leadId = null, quoteId = null, title = 'הזמנה חדשה', onCreated }) {
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
          <NewOrder
            asDialog
            dialogLeadId={leadId}
            dialogQuoteId={quoteId}
            onDialogClose={(order) => {
              onOpenChange(false);
              // order is truthy only on a successful create (null = cancel).
              if (order?.id) onCreated?.(order);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
