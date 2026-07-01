import React, { Suspense, lazy } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

// Lazy-load QuoteDetails so its bundle is only pulled when someone actually
// opens a quote, not on every list render.
const LazyQuoteDetails = lazy(() => import('@/pages/QuoteDetails.jsx'));

// Opens a quote as a popup over the list (no navigation), mirroring the order
// popup (OrderDetailsModal). Reuses the exact same QuoteDetails view in its
// `isModal` layout and the identical dialog frame so the two feel the same.
export default function QuoteDetailsModal({ quoteId, onClose }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <DialogContent
        dir="rtl"
        className="w-[80vw] max-w-[1100px] h-[95vh] p-0 gap-0 overflow-y-auto rounded-2xl
                   [&>button.absolute]:right-auto [&>button.absolute]:left-4"
      >
        <DialogTitle className="sr-only">פרטי הצעת מחיר</DialogTitle>
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full text-muted-foreground">
              טוען פרטי הצעה…
            </div>
          }
        >
          <LazyQuoteDetails id={quoteId} isModal onClose={onClose} />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
