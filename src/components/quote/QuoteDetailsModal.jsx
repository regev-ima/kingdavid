import React, { Suspense, lazy, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

// Lazy-load the views so their bundles are only pulled when someone actually
// opens / edits a quote, not on every list render.
const LazyQuoteDetails = lazy(() => import('@/pages/QuoteDetails.jsx'));
const LazyEditQuote = lazy(() => import('@/pages/EditQuote.jsx'));

// Opens a quote as a popup over the list (no navigation), mirroring the order
// popup (OrderDetailsModal). Editing happens IN the popup too: the edit button
// flips to the EditQuote view inside the same dialog instead of navigating to a
// separate page, and saving/canceling returns to the detail view.
export default function QuoteDetailsModal({ quoteId, onClose }) {
  const [editing, setEditing] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <DialogContent
        dir="rtl"
        className="w-[80vw] max-w-[1100px] h-[95vh] p-0 gap-0 overflow-y-auto rounded-2xl
                   [&>button.absolute]:right-auto [&>button.absolute]:left-4"
      >
        <DialogTitle className="sr-only">{editing ? 'עריכת הצעת מחיר' : 'פרטי הצעת מחיר'}</DialogTitle>
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {editing ? 'טוען עריכה…' : 'טוען פרטי הצעה…'}
            </div>
          }
        >
          {editing ? (
            <LazyEditQuote
              id={quoteId}
              isModal
              onExit={() => setEditing(false)}
              onSaved={() => setEditing(false)}
            />
          ) : (
            <LazyQuoteDetails id={quoteId} isModal onClose={onClose} onEdit={() => setEditing(true)} />
          )}
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
