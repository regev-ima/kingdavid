import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { AlertTriangle, ChevronLeft } from 'lucide-react';

// Red banner shown at the top while the rep has WhatsApp conversations waiting
// for a reply (status = 'waiting' — i.e. the last message was incoming). It is
// RLS-scoped, so a rep sees only their own count. Disappears automatically once
// everything is answered. Polls every 30s and on window focus so it stays live
// even without a realtime connection.
export default function WhatsAppWaitingBanner() {
  const { data: count = 0 } = useQuery({
    queryKey: ['wa-waiting-count'],
    queryFn: () => base44.entities.WhatsAppChat.count({ status: 'waiting' }),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 10000,
  });

  if (!count) return null;

  return (
    <Link
      to={createPageUrl('WhatsAppChat')}
      dir="rtl"
      className="flex items-center justify-center gap-2 bg-red-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-red-700 transition-colors"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 animate-pulse" />
      <span>
        {count === 1
          ? 'לקוח אחד ממתין לתשובה בוואטסאפ'
          : `${count} לקוחות ממתינים לתשובה בוואטסאפ`}
      </span>
      <span className="underline underline-offset-2 inline-flex items-center">
        מעבר לצ'אט <ChevronLeft className="h-4 w-4" />
      </span>
    </Link>
  );
}
