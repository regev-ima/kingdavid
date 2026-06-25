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
          stays comfortable.

          dir="rtl" is REQUIRED here: Radix Dialog portals to
          document.body, which sits outside the dir="rtl" wrapper in
          Layout.jsx, so without this override the Hebrew content
          renders left-aligned. Matches the convention used by every
          other DialogContent in this codebase. */}
      <DialogContent
        dir="rtl"
        className="w-[94vw] max-w-[1280px] h-[92vh] p-0 gap-0 overflow-hidden flex flex-col rounded-2xl
                   [&>button.absolute]:right-auto [&>button.absolute]:left-4"
      >
        <DialogTitle className="sr-only">פרטי ליד</DialogTitle>
        {/* Hand the entire dialog body to LeadDetails. In isModal mode
            it lays itself out as a flex column with a fixed top bar +
            action bar and an internal scrollable body — that way the
            header truly never moves and never gets occluded by content
            scrolling past it, which sticky positioning was struggling
            with in this portal/transform context. */}
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full text-muted-foreground">
              טוען פרטי ליד…
            </div>
          }
        >
          <LazyLeadDetails leadId={leadId} initialMode={mode} isModal onClose={onClose} />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
