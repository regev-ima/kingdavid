import React, { Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

// Lazy-load LeadDetails so we don't pull its 1.6k-line bundle on every
// page render — only when a manager actually opens a lead.
const LazyLeadDetails = lazy(() => import('@/pages/LeadDetails.jsx'));

export default function LeadDetailsModal({ backgroundLocation }) {
  const navigate = useNavigate();

  const close = () => {
    // Prefer history-back so the list page underneath keeps its
    // scroll position and filter state (browser restores them
    // naturally on back-nav). If we got here via a deep link with
    // no prior history (refresh, bookmark, /LeadDetails opened in a
    // new tab), fall back to /LeadManagement.
    if (backgroundLocation) {
      navigate(-1);
    } else {
      navigate('/LeadManagement');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent
        // 95vw × 95vh per product spec — leave a visible frame of
        // the underlying list page on all sides so the manager
        // immediately reads this as "a popup over my list", not
        // "I navigated to a new page". max-w-none defeats the
        // shadcn default max-w-lg cap so wide monitors keep the
        // 95% proportion.
        className="w-[95vw] h-[95vh] max-w-none p-0 gap-0 overflow-hidden flex flex-col rounded-2xl"
      >
        <DialogTitle className="sr-only">פרטי ליד</DialogTitle>
        <div className="flex-1 overflow-auto p-6 pt-10">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-muted-foreground">
                טוען פרטי ליד…
              </div>
            }
          >
            <LazyLeadDetails />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
}
