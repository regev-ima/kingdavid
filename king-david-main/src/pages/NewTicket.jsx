import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, Save, Loader2 } from "lucide-react";
import { addHours } from 'date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessSupportWorkspace } from '@/lib/rbac';

const slaDurations = {
  urgent: 4,
  high: 24,
  medium: 48,
  low: 72,
};

export default function NewTicket() {
  const navigate = useNavigate();
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const urlParams = new URLSearchParams(window.location.search);
  const orderId = urlParams.get('order_id');

  const [formData, setFormData] = useState({
    order_id: orderId || '',
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    category: 'other',
    priority: 'medium',
    subject: '',
    description: '',
    status: 'open',
  });

  const createTicketMutation = useMutation({
    mutationFn: async (data) => {
      const tickets = await base44.entities.SupportTicket.list('-created_date', 1);
      const lastNumber = tickets[0]?.ticket_number?.replace('TKT', '') || '1000';
      const newNumber = `TKT${parseInt(lastNumber) + 1}`;
      
      const slaHours = slaDurations[data.priority];
      const slaDueDate = addHours(new Date(), slaHours);
      
      return base44.entities.SupportTicket.create({
        ...data,
        ticket_number: newNumber,
        sla_due_date: slaDueDate.toISOString(),
        assigned_to: effectiveUser?.email,
      });
    },
    onSuccess: (ticket) => {
      navigate(createPageUrl('TicketDetails') + `?id=${ticket.id}`);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createTicketMutation.mutate(formData);
  };

  if (isLoadingUser) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (!canAccessSupportWorkspace(effectiveUser)) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לפתוח קריאת שירות</p>
        <Link to={createPageUrl('Support')}>
          <Button className="mt-4">חזור לשירות לקוחות</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link to={createPageUrl('Support')}>
          <Button variant="ghost" size="icon">
            <ArrowRight className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">קריאת שירות חדשה</h1>
          <p className="text-muted-foreground">פתיחת קריאה חדשה במערכת</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>פרטי לקוח</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>שם לקוח *</Label>
                <Input
                  value={formData.customer_name}
                  onChange={(e) => setFormData({...formData, customer_name: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>טלפון *</Label>
                <Input
                  value={formData.customer_phone}
                  onChange={(e) => setFormData({...formData, customer_phone: e.target.value})}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>אימייל</Label>
              <Input
                type="email"
                value={formData.customer_email}
                onChange={(e) => setFormData({...formData, customer_email: e.target.value})}
              />
            </div>
            {orderId && (
              <div className="space-y-2">
                <Label>מספר הזמנה</Label>
                <Input value={orderId} disabled className="bg-muted" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>פרטי הקריאה</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>קטגוריה *</Label>
                <Select 
                  value={formData.category} 
                  onValueChange={(v) => setFormData({...formData, category: v})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="delivery">משלוח</SelectItem>
                    <SelectItem value="quality">איכות</SelectItem>
                    <SelectItem value="return">החזרה</SelectItem>
                    <SelectItem value="trial">ניסיון 30 יום</SelectItem>
                    <SelectItem value="billing">חיוב</SelectItem>
                    <SelectItem value="warranty">אחריות</SelectItem>
                    <SelectItem value="other">אחר</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>עדיפות *</Label>
                <Select 
                  value={formData.priority} 
                  onValueChange={(v) => setFormData({...formData, priority: v})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">נמוך (72 שעות)</SelectItem>
                    <SelectItem value="medium">בינוני (48 שעות)</SelectItem>
                    <SelectItem value="high">גבוה (24 שעות)</SelectItem>
                    <SelectItem value="urgent">דחוף (4 שעות)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>נושא *</Label>
              <Input
                value={formData.subject}
                onChange={(e) => setFormData({...formData, subject: e.target.value})}
                required
                placeholder="תאר את הבעיה בקצרה..."
              />
            </div>
            <div className="space-y-2">
              <Label>תיאור מפורט</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                rows={4}
                placeholder="פרט את הבעיה, מה קרה, מתי..."
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 mt-6">
          <Link to={createPageUrl('Support')}>
            <Button type="button" variant="outline">ביטול</Button>
          </Link>
          <Button 
            type="submit" 
            className="bg-primary hover:bg-primary/90"
            disabled={createTicketMutation.isPending}
          >
            {createTicketMutation.isPending ? (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 me-2" />
            )}
            פתח קריאה
          </Button>
        </div>
      </form>
    </div>
  );
}
