import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Phone, MessageCircle, Mail, Calendar, Clock, Headphones, X, History } from "lucide-react";
import { format } from '@/lib/safe-date-fns';

const communicationIcons = {
  call: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  meeting: Calendar,
};

const outcomeLabels = {
  answered_positive: 'נענה - חיובי',
  answered_neutral: 'נענה - ניטרלי',
  answered_negative: 'נענה - שלילי',
  no_answer: 'לא נענה',
  voicemail: 'הותיר הודעה',
  sent: 'נשלח',
};

const outcomeColors = {
  answered_positive: 'bg-green-100 text-green-800',
  answered_neutral: 'bg-blue-100 text-blue-800',
  answered_negative: 'bg-red-100 text-red-800',
  no_answer: 'bg-muted text-foreground',
  voicemail: 'bg-yellow-100 text-yellow-800',
  sent: 'bg-primary/10 text-primary',
};

export default function CommunicationHistory({ leadId }) {
  const [recordingUrl, setRecordingUrl] = useState(null);
  
  // Single parallel fetch for both entities
  const { data: combinedData, isLoading } = useQuery({
    queryKey: ['allCommunications', leadId],
    queryFn: async () => {
      const [comms, calls, audits] = await Promise.all([
        base44.entities.CommunicationLog.filter({ lead_id: leadId }),
        base44.entities.CallLog.filter({ lead_id: leadId }),
        base44.entities.AuditLog.filter({ entity_id: leadId, entity_name: 'Lead' }),
      ]);
      return { comms, calls, audits };
    },
    enabled: !!leadId,
    staleTime: 120000,
  });

  const communications = combinedData?.comms || [];
  const callLogs = combinedData?.calls || [];
  const audits = combinedData?.audits || [];

  const allItems = [
    ...communications.map(c => ({ ...c, type: 'communication' })),
    ...callLogs.map(c => ({ ...c, type: 'call' })),
    ...audits.map(c => ({ ...c, type: 'audit' }))
  ];

  const sortedCommunications = [...allItems].sort(
    (a, b) => (new Date(b.created_date || b.call_started_at || 0).getTime() || 0) - (new Date(a.created_date || a.call_started_at || 0).getTime() || 0)
  );

  if (isLoading) {
    return <div className="text-center py-4 text-muted-foreground">טוען...</div>;
  }

  if (allItems.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-20" />
        <p>אין היסטוריית תקשורת</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 w-full">
      {sortedCommunications.map((item) => {
        const isCall = item.type === 'call';
        const isAudit = item.type === 'audit';
        const Icon = isCall ? Phone : isAudit ? History : (communicationIcons[item.type] || Phone);
        const dateStr = isCall ? item.call_started_at : item.created_date;
        
        return (
          <div
            key={item.id}
            className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${isAudit ? 'bg-muted' : 'bg-primary/5'}`}>
                <Icon className={`h-5 w-5 ${isAudit ? 'text-muted-foreground' : 'text-primary'}`} />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="capitalize">
                      {isCall ? 'שיחה' : isAudit ? 'שינוי מערכת' : item.type}
                    </Badge>
                    {item.call_direction && (
                      <Badge variant="outline" className="text-xs">
                        {item.call_direction === 'inbound' ? 'נכנס' : 'יוצא'}
                      </Badge>
                    )}
                    {item.direction && (
                      <Badge variant="outline" className="text-xs">
                        {item.direction === 'inbound' ? 'נכנס' : 'יוצא'}
                      </Badge>
                    )}
                    {item.call_result && (
                      <Badge className={outcomeColors[item.call_result] || 'bg-muted text-foreground'}>
                        {outcomeLabels[item.call_result] || item.call_result}
                      </Badge>
                    )}
                    {item.outcome && (
                      <Badge className={outcomeColors[item.outcome]}>
                        {outcomeLabels[item.outcome]}
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(dateStr), 'dd/MM/yyyy HH:mm')}
                  </span>
                </div>

                {item.subject && (
                  <p className="font-medium text-sm mb-1">{item.subject}</p>
                )}

                {isAudit && (
                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium mb-1">{item.description}</p>
                    {item.metadata && (
                      <div className="text-xs bg-muted p-2 rounded mt-1 space-y-1">
                        {item.metadata.previous_rep1 && (
                          <p>נציג קודם: {item.metadata.previous_rep1}</p>
                        )}
                        {item.metadata.new_rep1 && (
                          <p>נציג חדש: {item.metadata.new_rep1}</p>
                        )}
                        {item.metadata.changed_by && (
                          <p className="text-muted-foreground/70 mt-1">שונה ע"י: {item.metadata.changed_by}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {item.content && (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-1">
                    {item.content}
                  </p>
                )}

                {item.call_duration_seconds && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>משך: {Math.floor(item.call_duration_seconds / 60)}:{(item.call_duration_seconds % 60).toString().padStart(2, '0')}</span>
                  </div>
                )}

                {item.duration_seconds && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>משך: {Math.floor(item.duration_seconds / 60)}:{(item.duration_seconds % 60).toString().padStart(2, '0')}</span>
                  </div>
                )}

                {item.call_notes && (
                  <p className="text-sm text-muted-foreground mt-2">{item.call_notes}</p>
                )}

                {item.notes && (
                  <p className="text-xs text-muted-foreground mt-2 italic">{item.notes}</p>
                )}

                {item.recording_url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRecordingUrl(item.recording_url)}
                    className="inline-flex items-center gap-1 mt-2 h-auto p-0 text-xs text-primary hover:text-primary/80 hover:bg-transparent"
                  >
                    <Headphones className="h-3 w-3" />
                    <span>האזן להקלטה</span>
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      <Dialog open={!!recordingUrl} onOpenChange={() => setRecordingUrl(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Headphones className="h-5 w-5 text-primary" />
              הקלטת שיחה
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <div className="bg-gradient-to-br from-primary/5 to-purple-50/50 rounded-lg p-4">
              <iframe
                src={recordingUrl}
                className="w-full h-[120px] border-0 rounded-lg"
                title="הקלטת שיחה"
                allow="autoplay"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-3 text-center">
              ההקלטה מתנגנת מ-VoiceCenter
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}