import React from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import ServiceRequestDetailContent from './ServiceRequestDetailContent';

// Opens a service ticket as a popup over the list (no navigation), mirroring
// the lead popup pattern. Reuses the exact same detail content as the
// standalone /ServiceRequestDetails page.
export default function ServiceRequestModal({ ticketId, open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="w-[80vw] max-w-[1100px] h-[95vh] p-0 gap-0 overflow-hidden flex flex-col rounded-2xl
                   [&>button.absolute]:right-auto [&>button.absolute]:left-4"
      >
        <DialogTitle className="sr-only">פרטי פניית שירות</DialogTitle>
        {ticketId && <ServiceRequestDetailContent ticketId={ticketId} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
