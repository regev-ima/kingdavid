import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useMutation, useQuery } from '@tanstack/react-query';
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
import { ArrowRight, Save, Loader2, User, UserCheck, X } from "lucide-react";
import { addHours } from '@/lib/safe-date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessSupportWorkspace } from '@/lib/rbac';

const slaDurations = {
  urgent: 4,
  high: 24,
  medium: 48,
  low: 72,
};

// Strip everything but digits, then drop a leading country prefix so
// "0537772829", "053-777-2829", "+972537772829", "972537772829" all match.
function normalizePhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('972') && digits.length >= 11) return '0' + digits.slice(3);
  return digits;
}

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
    customer_id: null,
    lead_id: null,
  });

  // Phone-based lookup. Debounce the phone value (350ms) so we don't fire a
  // round-trip on every keystroke, and only search once the user has typed
  // at least 7 digits — anything shorter is too noisy to be useful.
  const [debouncedPhone, setDebouncedPhone] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedPhone(normalizePhone(formData.customer_phone)), 350);
    return () => clearTimeout(t);
  }, [formData.customer_phone]);

  const phoneSearchEnabled = debouncedPhone.length >= 7;

  const { data: phoneMatches } = useQuery({
    queryKey: ['ticketPhoneLookup', debouncedPhone],
    enabled: phoneSearchEnabled,
    staleTime: 60_000,
    queryFn: async () => {
      // Use the LAST 9 digits (national subscriber portion) as the lookup
      // key so we hit either "0537772829" or "+972537772829" stored values.
      const tail = debouncedPhone.slice(-9);
      const pattern = `%${tail}%`;
      const [{ data: customers, error: cErr }, { data: leads, error: lErr }] = await Promise.all([
        base44.supabase
          .from('customers')
          .select('id, full_name, phone, email')
          .ilike('phone', pattern)
          .limit(5),
        base44.supabase
          .from('leads')
          .select('id, full_name, phone, email, status')
          .ilike('phone', pattern)
          .limit(5),
      ]);
      if (cErr) throw cErr;
      if (lErr) throw lErr;
      return { customers: customers || [], leads: leads || [] };
    },
  });

  const matches = useMemo(() => {
    if (!phoneMatches) return [];
    const c = phoneMatches.customers.map((row) => ({ kind: 'customer', ...row }));
    const l = phoneMatches.leads.map((row) => ({ kind: 'lead', ...row }));
    return [...c, ...l];
  }, [phoneMatches]);

  // Skip the suggestions panel when we've already linked a record (the user
  // picked one), or when the phone is too short to search.
  const showMatches = phoneSearchEnabled
    && matches.length > 0
    && !formData.customer_id
    && !formData.lead_id;

  const applyMatch = (match) => {
    setFormData((prev) => ({
      ...prev,
      customer_name: match.full_name || prev.customer_name,
      customer_email: match.email || prev.customer_email,
      customer_phone: match.phone || prev.customer_phone,
      customer_id: match.kind === 'customer' ? match.id : null,
      lead_id: match.kind === 'lead' ? match.id : null,
    }));
  };

  const clearLink = () => {
    setFormData((prev) => ({ ...prev, customer_id: null, lead_id: null }));
  };

  const createTicketMutation = useMutation({
    mutationFn: async (data) => {
      const tickets = await base44.entities.SupportTicket.list('-created_date', 1);
      const lastNumber = tickets[0]?.ticket_number?.replace('TKT', '') || '1000';
      const newNumber = `TKT${parseInt(lastNumber) + 1}`;

      const slaHours = slaDurations[data.priority];
      const slaDueDate = addHours(new Date(), slaHours);

      // support_tickets in this account's deployed schema does NOT yet have
      // customer_id / lead_id columns (PGRST204 confirmed). Strip them out
      // of the payload until the matching migration runs — the auto-filled
      // name / phone / email already give the agent everything needed to
      // identify the customer.
      const { customer_id: _cid, lead_id: _lid, ...payload } = data;

      // Postgres UUID columns reject "" (22P02 invalid input syntax). The
      // form initializes order_id with `urlParams.get('order_id') || ''`, so
      // a ticket opened from /Support (no order context) was sending "" and
      // failing. Convert empty strings on any uuid-typed key to null. Keep
      // this list narrow — only fields we know are UUID columns.
      const UUID_KEYS = ['order_id'];
      for (const key of UUID_KEYS) {
        if (payload[key] === '') payload[key] = null;
      }

      return base44.entities.SupportTicket.create({
        ...payload,
        ticket_number: newNumber,
        sla_due_date: slaDueDate.toISOString(),
        assigned_to: effectiveUser?.email,
      });
    },
    onSuccess: (ticket) => {
      toast.success('הקריאה נפתחה');
      navigate(createPageUrl('TicketDetails') + `?id=${ticket.id}`);
    },
    onError: (err) => {
      console.error('[NewTicket] create failed', { message: err?.message, details: err?.details, hint: err?.hint, code: err?.code, raw: err });
      const parts = [err?.message, err?.details, err?.hint, err?.code].filter(Boolean);
      toast.error(`פתיחת קריאה נכשלה: ${parts.join(' — ') || JSON.stringify(err)}`, { duration: Infinity });
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
                  onChange={(e) => setFormData({...formData, customer_phone: e.target.value, customer_id: null, lead_id: null})}
                  required
                />
              </div>
            </div>
            {(formData.customer_id || formData.lead_id) ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-emerald-800">
                  <UserCheck className="h-4 w-4" />
                  <span>
                    {formData.customer_id ? 'מקושר ללקוח קיים' : 'מקושר לליד קיים'}
                    {formData.customer_name ? ` — ${formData.customer_name}` : ''}
                  </span>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={clearLink} className="h-7 px-2 text-emerald-700">
                  <X className="h-3.5 w-3.5 me-1" />
                  בטל קישור
                </Button>
              </div>
            ) : null}
            {showMatches ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 space-y-2">
                <p className="text-xs text-blue-800 font-medium">נמצאו רשומות עם טלפון דומה — בחר כדי לקשר את הקריאה:</p>
                <div className="space-y-1.5">
                  {matches.map((m) => (
                    <button
                      key={`${m.kind}-${m.id}`}
                      type="button"
                      onClick={() => applyMatch(m)}
                      className="w-full text-right rounded-md bg-white border border-blue-100 px-3 py-2 hover:border-blue-300 hover:shadow-sm transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <div className="text-sm min-w-0">
                          <div className="font-medium truncate">{m.full_name || '(ללא שם)'}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {m.phone || '-'} {m.email ? `• ${m.email}` : ''}
                          </div>
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${m.kind === 'customer' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {m.kind === 'customer' ? 'לקוח' : 'ליד'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
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
