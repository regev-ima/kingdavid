import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import { createPageUrl } from '@/utils';
import { AlertTriangle, ChevronLeft } from 'lucide-react';

// Red banner shown at the top while the rep has WhatsApp conversations waiting
// for a reply (status = 'waiting' — i.e. the last message was incoming). It is
// RLS-scoped, so a rep sees only their own count. Disappears automatically once
// everything is answered.
//
// Freshness: it listens to whatsapp_chats over Realtime so it appears almost
// instantly when a new message lands, and also polls every 15s + on window
// focus as a fallback in case Realtime is unavailable.
export default function WhatsAppWaitingBanner() {
  const queryClient = useQueryClient();

  const { data: count = 0 } = useQuery({
    queryKey: ['wa-waiting-count'],
    queryFn: () => base44.entities.WhatsAppChat.count({ status: 'waiting' }),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 5000,
  });

  // Live refresh: any change to the rep's chats re-checks the waiting count.
  useEffect(() => {
    const channel = supabase
      .channel('wa-banner-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_chats' }, () => {
        queryClient.invalidateQueries({ queryKey: ['wa-waiting-count'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

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
