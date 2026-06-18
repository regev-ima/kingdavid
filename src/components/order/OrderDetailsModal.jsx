import React, { Suspense, lazy } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

// Lazy-load OrderDetails so its bundle is only pulled when someone actually
// opens an order, not on every list render.
const LazyOrderDetails = lazy(() => import('@/pages/OrderDetails.jsx'));

// Opens an order as a popup over the list (no navigation), mirroring the lead
// and service-ticket popups. Reuses the exact same OrderDetails view in its
// `isModal` layout, and the identical dialog sizing so all three popups feel
// the same.
export default function OrderDetailsModal({ orderId, onClose }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose?.(); }}>
      {/* Same frame as LeadDetailsModal / ServiceRequestModal: capped at
          1100px on wide monitors, 80vw on laptops, 95vh tall. dir="rtl" is
          required because Radix portals to document.body, outside the
          dir="rtl" wrapper in Layout.jsx. */}
      <DialogContent
        dir="rtl"
        className="w-[80vw] max-w-[1100px] h-[95vh] p-0 gap-0 overflow-hidden flex flex-col rounded-2xl
                   [&>button.absolute]:right-auto [&>button.absolute]:left-4"
      >
        <DialogTitle className="sr-only">פרטי הזמנה</DialogTitle>
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full text-muted-foreground">
              טוען פרטי הזמנה…
            </div>
          }
        >
          <LazyOrderDetails orderId={orderId} isModal onClose={onClose} />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
