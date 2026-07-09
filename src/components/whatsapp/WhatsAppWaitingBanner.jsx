import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import { createPageUrl } from '@/utils';
import { parseDbTimestamp } from '@/lib/safe-date-fns-tz';
import { formatDuration } from '@/components/whatsapp/whatsappHelpers';
import { AlertTriangle, ChevronLeft, Clock } from 'lucide-react';

// Red banner shown at the top while the rep has WhatsApp conversations waiting
// for a reply (status = 'waiting'). RLS-scoped to the rep's own chats. Shows
// how many are waiting AND a live timer of how long the oldest one has waited,
// so the rep feels the urgency. Disappears once everything is answered.
export default function WhatsAppWaitingBanner() {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());

  const { data: count = 0 } = useQuery({
    queryKey: ['wa-waiting-count'],
    queryFn: () => base44.entities.WhatsAppChat.count({ status: 'waiting' }),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 5000,
  });

  // Oldest waiting conversation (ascending by last_message_at → first is oldest)
  // drives the "waited for…" timer.
  const { data: oldest } = useQuery({
    queryKey: ['wa-waiting-oldest'],
    queryFn: async () => {
      const rows = await base44.entities.WhatsAppChat.filter({ status: 'waiting' }, 'last_message_at', 1);
      return rows?.[0] || null;
    },
    enabled: count > 0,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  // Tick once a minute so the elapsed timer stays current without refetching.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  // Live refresh of the count whenever the rep's chats change.
  useEffect(() => {
    const channel = supabase
      .channel('wa-banner-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_chats' }, () => {
        queryClient.invalidateQueries({ queryKey: ['wa-waiting-count'] });
        queryClient.invalidateQueries({ queryKey: ['wa-waiting-oldest'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  if (!count) return null;

  const oldestMs = oldest?.last_message_at ? (parseDbTimestamp(oldest.last_message_at)?.getTime() ?? null) : null;
  const waitedSec = oldestMs ? Math.max(0, (now - oldestMs) / 1000) : null;

  return (
    <Link
      to={`${createPageUrl('WhatsAppChat')}?focus=waiting`}
      dir="rtl"
      className="flex items-center justify-center gap-2 bg-red-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-red-700 transition-colors flex-wrap"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 animate-pulse" />
      <span>
        {count === 1
          ? 'לקוח אחד ממתין לתשובה בוואטסאפ'
          : `${count} לקוחות ממתינים לתשובה בוואטסאפ`}
      </span>
      {waitedSec != null && (
        <span className="inline-flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5 text-xs">
          <Clock className="h-3 w-3" />
          {count === 1 ? 'ממתין' : 'הוותיק ממתין'} {formatDuration(waitedSec)}
        </span>
      )}
      <span className="underline underline-offset-2 inline-flex items-center">
        מעבר לצ'אט <ChevronLeft className="h-4 w-4" />
      </span>
    </Link>
  );
}
