import React from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import ServiceRequestDetailContent from './ServiceRequestDetailContent';

// Opens a service ticket as a popup over the list (no navigation), mirroring
// the lead popup pattern. Reuses the exact same detail content as the
// standalone /ServiceRequestDetails page.
export default function ServiceRequestModal({ ticketId, open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] max-w-[920px] max-h-[90vh] overflow-y-auto p-5" dir="rtl">
        <DialogTitle className="sr-only">פרטי פניית שירות</DialogTitle>
        {ticketId && <ServiceRequestDetailContent ticketId={ticketId} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
