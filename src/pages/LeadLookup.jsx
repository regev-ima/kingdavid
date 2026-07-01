import React from 'react';
import LeadLookupPanel from '@/components/lead/LeadLookupPanel';

// Full-page "איתור ליד" screen. The search field + live results live in the
// shared LeadLookupPanel so the popup (LeadLookupDialog) behaves identically.
export default function LeadLookup() {
  return (
    <div className="min-h-[calc(100vh-7rem)] flex flex-col items-center pt-12 sm:pt-20 px-4" dir="rtl">
      <div className="w-full max-w-2xl space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">איתור ליד</h1>
          <p className="text-sm text-muted-foreground">חפש לידים במאגר לפי מספר טלפון, שם, או אימייל</p>
        </div>
      </div>
      <div className="w-full max-w-3xl mt-6">
        <LeadLookupPanel />
      </div>
    </div>
  );
}
