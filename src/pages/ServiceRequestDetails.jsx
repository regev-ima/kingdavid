import React from 'react';
import ServiceRequestDetailContent from '@/components/service/ServiceRequestDetailContent';

// Standalone page for a service ticket (deep links + the link from an order).
// The in-list popup (ServiceRequestModal) renders the same content component.
export default function ServiceRequestDetails() {
  const ticketId = new URLSearchParams(window.location.search).get('id');
  return (
    <div className="max-w-4xl mx-auto">
      <ServiceRequestDetailContent ticketId={ticketId} />
    </div>
  );
}
