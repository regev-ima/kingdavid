import React, { Suspense, lazy } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

// Lazy-load LeadDetails so its large bundle is only pulled when a
// manager actually opens a lead, not on every list render.
const LazyLeadDetails = lazy(() => import('@/pages/LeadDetails.jsx'));

export default function LeadDetailsModal({ leadId, mode = 'sales', onClose }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose?.(); }}>
      {/* 95vw × 95vh per product spec — a deliberate frame of the dimmed
          list page stays visible on every side so this unmistakably
          reads as a popup over the list, never as a page change. The URL
          never changes and the list underneath stays mounted, so closing
          drops the manager back exactly where they were. Esc, the X, and
          a click on the dimmed backdrop all close it (Radix → onClose).
          max-w-none defeats the shadcn default max-w-lg cap. */}
      <DialogContent className="w-[95vw] h-[95vh] max-w-none p-0 gap-0 overflow-hidden flex flex-col rounded-2xl">
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
