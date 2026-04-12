import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone, PhoneIncoming, PhoneOutgoing, User, MapPin, Mail, Clock, X } from "lucide-react";
import { format } from 'date-fns';

export default function VoiceCenterCallPopup() {
  const [sdk, setSdk] = useState(null);
  const [currentCall, setCurrentCall] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [leadData, setLeadData] = useState(null);

  // Fetch user credentials
  const { data: credentialsData } = useQuery({
    queryKey: ['voicecenterCredentials'],
    queryFn: async () => {
      const response = await base44.functions.invoke('getVoicecenterCredentials');
      return response.data;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!credentialsData?.hasCredentials) return;
    if (!window.EventsSDK) {
      console.error('VoiceCenter EventsSDK not loaded');
      return;
    }

    // Initialize VoiceCenter Events SDK
    const newSdk = new window.EventsSDK({
      loginType: 'user',
      email: credentialsData.username,
      password: credentialsData.password,
    });

    newSdk.init().then(() => {
      // Listen for extension events (calls)
      newSdk.on('ExtensionEvent', async (response) => {
        await handleExtensionEvent(response);
      });

    }).catch((error) => {
      console.error('Failed to initialize VoiceCenter SDK:', error);
    });

    setSdk(newSdk);

    return () => {
      if (newSdk) {
        newSdk.disconnect();
      }
    };
  }, [credentialsData]);

  const handleExtensionEvent = async (response) => {
    const eventData = response.data;
    
    // Only show popup for ringing or answered calls
    if (eventData.reason !== 'ringing' && eventData.reason !== 'answered') {
      return;
    }

    // Determine direction based on event data
    const direction = eventData.callerid ? 'incoming' : 'outgoing';
    const phoneNumber = eventData.callerid || eventData.destination;

    setCurrentCall({
      direction,
      phoneNumber,
      reason: eventData.reason,
      callId: eventData.ivrid,
      extension: eventData.extension,
    });
    setIsOpen(true);

    // Fetch lead information based on phone number
    if (phoneNumber) {
      try {
        const leads = await base44.entities.Lead.filter({ phone: phoneNumber });
        if (leads.length > 0) {
          setLeadData(leads[0]);
        } else {
          setLeadData(null);
        }
      } catch (error) {
        console.error('Error fetching lead:', error);
        setLeadData(null);
      }
    }
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  if (!currentCall) return null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {currentCall.direction === 'incoming' ? (
              <>
                <PhoneIncoming className="h-5 w-5 text-green-600" />
                שיחה נכנסת
              </>
            ) : (
              <>
                <PhoneOutgoing className="h-5 w-5 text-blue-600" />
                שיחה יוצאת
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {leadData ? (
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-lg">{leadData.full_name}</p>
                    <Badge variant="outline">{leadData.status}</Badge>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    <span>{leadData.phone}</span>
                  </div>
                  
                  {leadData.email && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="h-4 w-4" />
                      <span>{leadData.email}</span>
                    </div>
                  )}
                  
                  {leadData.city && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      <span>{leadData.city}</span>
                    </div>
                  )}

                  {leadData.created_date && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span>לקוח מ-{format(new Date(leadData.created_date), 'dd/MM/yyyy')}</span>
                    </div>
                  )}
                </div>

                {leadData.notes && (
                  <div className="pt-3 border-t">
                    <p className="text-sm font-medium mb-1">הערות:</p>
                    <p className="text-sm text-muted-foreground">{leadData.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <Phone className="h-12 w-12 mx-auto text-muted-foreground/70 mb-3" />
                  <p className="font-medium">מספר לא מזוהה</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {currentCall.phoneNumber}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Button variant="outline" onClick={handleClose}>
              <X className="h-4 w-4 me-2" />
              סגור
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}