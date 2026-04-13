import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Phone,
  MessageCircle,
  FileText,
  ShoppingCart,
  Headphones,
  RotateCcw,
  MoreVertical,
  Send,
  Eye,
  Loader2
} from "lucide-react";
import { toast } from 'sonner';
import { formatPhoneForWhatsApp } from '@/utils/phoneUtils';

export default function QuickActions({
  type,
  data,
  onCall,
  onWhatsApp,
  onSendQuote,
  onConvertToOrder,
  onCreateTicket,
  onCreateReturn,
  onView,
  hideContactButtons
}) {
  const navigate = useNavigate();
  const [isCalling, setIsCalling] = useState(false);

  const handleCall = async () => {
    const phoneNumber = data.phone || data.customer_phone;
    if (!phoneNumber) {
      toast.error('מספר טלפון חסר');
      return;
    }

    setIsCalling(true);
    try {
      const response = await base44.functions.invoke('clickToCall', {
        customerPhone: phoneNumber
      });

      if (response.data.success) {
        toast.success('השיחה התחילה בהצלחה!');
        onCall?.(data);
      } else {
        toast.error('שגיאה ביצירת שיחה');
      }
    } catch (error) {
      toast.error('שגיאה ביצירת שיחה');
    } finally {
      setIsCalling(false);
    }
  };

  const handleWhatsApp = () => {
    const whatsappPhone = formatPhoneForWhatsApp(data.phone || data.customer_phone);
    if (whatsappPhone) {
      window.open(`https://wa.me/${whatsappPhone}`, '_blank');
      onWhatsApp?.(data);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {!hideContactButtons && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-emerald-600 hover:bg-muted"
            onClick={handleCall}
            disabled={isCalling}
            title="התקשר"
            aria-label="התקשר"
          >
            {isCalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-green-600 hover:bg-muted"
            onClick={handleWhatsApp}
            title="WhatsApp"
            aria-label="שלח WhatsApp"
          >
            <MessageCircle className="h-4 w-4" />
          </Button>
        </>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="פעולות נוספות">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {onView && (
            <DropdownMenuItem onClick={onView}>
              <Eye className="h-4 w-4 me-2" />
              צפה בפרטים
            </DropdownMenuItem>
          )}

          {type === 'lead' && (
            <>
              <DropdownMenuItem onClick={() => navigate(createPageUrl('NewQuote') + `?leadId=${data.id}`)}>
                <FileText className="h-4 w-4 me-2" />
                צור הצעת מחיר
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate(createPageUrl('NewOrder') + `?leadId=${data.id}`)}>
                <ShoppingCart className="h-4 w-4 me-2" />
                המר להזמנה
              </DropdownMenuItem>
            </>
          )}

          {type === 'quote' && (
            <>
              <DropdownMenuItem onClick={() => onSendQuote?.(data)}>
                <Send className="h-4 w-4 me-2" />
                שלח ללקוח
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onConvertToOrder?.(data)}>
                <ShoppingCart className="h-4 w-4 me-2" />
                המר להזמנה
              </DropdownMenuItem>
            </>
          )}

          {(type === 'lead' || type === 'order') && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onCreateTicket?.(data)}>
                <Headphones className="h-4 w-4 me-2" />
                פתח קריאת שירות
              </DropdownMenuItem>
            </>
          )}

          {type === 'order' && (
            <DropdownMenuItem onClick={() => onCreateReturn?.(data)}>
              <RotateCcw className="h-4 w-4 me-2" />
              בקשת החזרה
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}