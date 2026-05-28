import React, { Suspense, lazy } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

// Lazy-load LeadDetails so its large bundle is only pulled when a
// manager actually opens a lead, not on every list render.
const LazyLeadDetails = lazy(() => import('@/pages/LeadDetails.jsx'));

export default function LeadDetailsModal({ leadId, mode = 'sales', onClose }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose?.(); }}>
      {/* Narrower than the full viewport so the dimmed list is clearly
          framed on the sides — popup, not page. Caps at 1100px on wide
          monitors (comfortable single-column reading width for the
          lead detail layout) and uses 80vw on narrower screens so it
          stays generous on laptops without overflowing on tablets.
          Height stays at 95vh so vertical scrolling inside the lead
          stays comfortable. */}
      <DialogContent className="w-[80vw] max-w-[1100px] h-[95vh] p-0 gap-0 overflow-hidden flex flex-col rounded-2xl">
        <DialogTitle className="sr-only">פרטי ליד</DialogTitle>
        <div className="flex-1 overflow-auto p-6 pt-10">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-muted-foreground">
                טוען פרטי ליד…
              </div>
            }
          >
            <LazyLeadDetails leadId={leadId} initialMode={mode} isModal onClose={onClose} />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
}
