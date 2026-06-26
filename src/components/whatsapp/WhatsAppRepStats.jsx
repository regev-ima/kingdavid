import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';
import UserAvatar from '@/components/shared/UserAvatar';
import { formatDuration } from './whatsappHelpers';

// Manager view: one row of numbers per rep — how many chats are waiting, the
// average reply time, how many were answered, and total chats. Reads the
// whatsapp_rep_stats view (RLS: an admin sees every rep).
export default function WhatsAppRepStats({ usersById = {} }) {
  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ['wa-rep-stats'],
    queryFn: () => base44.entities.WhatsAppRepStats.list(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });

  const sorted = [...rows].sort(
    (a, b) => (b.waiting_count || 0) - (a.waiting_count || 0) || (b.total_chats || 0) - (a.total_chats || 0),
  );

  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (isError) {
    return <p className="text-sm text-muted-foreground text-center py-8">לא ניתן לטעון מדדים כרגע (ייתכן שה-view עדיין לא נפרס).</p>;
  }
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground text-center py-8">אין עדיין נתוני וואטסאפ לנציגים.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground border-b">
            <th className="text-right py-2 px-2 font-medium">נציג</th>
            <th className="text-center py-2 px-2 font-medium">ממתינים</th>
            <th className="text-center py-2 px-2 font-medium">זמן תגובה ממוצע</th>
            <th className="text-center py-2 px-2 font-medium">נענו</th>
            <th className="text-center py-2 px-2 font-medium">סה״כ שיחות</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const u = usersById[r.user_id];
            return (
              <tr key={r.user_id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="py-2 px-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <UserAvatar user={u} size="sm" />
                    <span className="truncate">{u?.full_name || u?.email || '—'}</span>
                  </div>
                </td>
                <td className="text-center py-2 px-2">
                  {r.waiting_count > 0
                    ? <span className="inline-block bg-red-100 text-red-700 rounded-full px-2 py-0.5 text-xs font-semibold">{r.waiting_count}</span>
                    : <span className="text-muted-foreground">0</span>}
                </td>
                <td className="text-center py-2 px-2 font-medium">
                  {r.replies_count > 0 && r.avg_response_seconds != null ? formatDuration(r.avg_response_seconds) : '—'}
                </td>
                <td className="text-center py-2 px-2">{r.answered_count || 0}</td>
                <td className="text-center py-2 px-2">{r.total_chats || 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[11px] text-muted-foreground mt-3">
        זמן התגובה מחושב על פני 30 הימים האחרונים — מהודעה נכנסת ועד התשובה הראשונה של הנציג.
      </p>
    </div>
  );
}
