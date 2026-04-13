import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from "@/components/ui/badge";
import {
  UserPlus,
  RefreshCw,
  FileText,
  Edit3,
  CheckCircle,
  PlusCircle,
  Crown,
  MessageCircle,
  Clock,
} from "lucide-react";
import { formatInTimeZone } from '@/lib/safe-date-fns-tz';

const actionIcons = {
  created: PlusCircle,
  status_changed: RefreshCw,
  rep_assigned: UserPlus,
  rep_changed: RefreshCw,
  field_updated: Edit3,
  task_created: Clock,
  task_completed: CheckCircle,
  note_added: MessageCircle,
  quote_created: FileText,
  converted_to_customer: Crown,
};

const actionColors = {
  created: 'bg-green-100 text-green-700',
  status_changed: 'bg-blue-100 text-blue-700',
  rep_assigned: 'bg-violet-100 text-violet-700',
  rep_changed: 'bg-amber-100 text-amber-700',
  field_updated: 'bg-muted text-foreground/80',
  task_created: 'bg-primary/10 text-primary',
  task_completed: 'bg-emerald-100 text-emerald-700',
  note_added: 'bg-sky-100 text-sky-700',
  quote_created: 'bg-purple-100 text-purple-700',
  converted_to_customer: 'bg-yellow-100 text-yellow-700',
};

const actionLabels = {
  created: 'נוצר',
  status_changed: 'סטטוס',
  rep_assigned: 'שיוך',
  rep_changed: 'שינוי נציג',
  field_updated: 'עדכון',
  task_created: 'משימה',
  task_completed: 'הושלם',
  note_added: 'הערה',
  quote_created: 'הצעה',
  converted_to_customer: 'המרה',
};

export default function LeadActivityTimeline({ leadId }) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['leadActivityLogs', leadId],
    queryFn: () => base44.entities.LeadActivityLog.filter({ lead_id: leadId }),
    enabled: !!leadId,
    staleTime: 60000,
  });

  const sortedLogs = [...logs].sort(
    (a, b) => (new Date(b.created_date || 0).getTime() || 0) - (new Date(a.created_date || 0).getTime() || 0)
  );

  if (isLoading) {
    return <div className="text-center py-4 text-muted-foreground">טוען...</div>;
  }

  if (sortedLogs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="h-12 w-12 mx-auto mb-3 opacity-20" />
        <p>אין לוג פעולות</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {sortedLogs.map((log, index) => {
        const Icon = actionIcons[log.action_type] || Edit3;
        const colorClass = actionColors[log.action_type] || 'bg-muted text-foreground/80';
        const label = actionLabels[log.action_type] || log.action_type;
        const isLast = index === sortedLogs.length - 1;

        return (
          <div key={log.id} className="flex gap-3 relative">
            {/* Timeline line */}
            {!isLast && (
              <div className="absolute top-8 right-[15px] w-[2px] h-[calc(100%-8px)] bg-border" />
            )}

            {/* Icon */}
            <div className={`relative z-10 flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${colorClass}`}>
              <Icon className="h-3.5 w-3.5" />
            </div>

            {/* Content */}
            <div className="flex-1 pb-4 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                  {label}
                </Badge>
                <span className="text-[11px] text-muted-foreground/70">
                  {formatInTimeZone(
                    log.created_date || new Date().toISOString(),
                    'Asia/Jerusalem',
                    'dd/MM/yyyy HH:mm'
                  )}
                </span>
              </div>

              <p className="text-sm text-foreground">{log.action_description}</p>

              {log.field_name && log.old_value != null && log.new_value != null && (
                <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                  <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded line-through">
                    {log.old_value || '(ריק)'}
                  </span>
                  <span className="text-muted-foreground/70">&larr;</span>
                  <span className="bg-green-50 text-green-600 px-1.5 py-0.5 rounded">
                    {log.new_value || '(ריק)'}
                  </span>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                {log.performed_by_name}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
