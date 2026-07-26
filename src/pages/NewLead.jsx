import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { createAuditLog } from '@/utils/auditLog';
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
import { ArrowRight, Save, Loader2, AlertTriangle } from "lucide-react";
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import LeadMarketingSection from '@/components/lead/LeadMarketingSection';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import IsraeliPhoneInput from '@/components/shared/IsraeliPhoneInput';
import { isValidIsraeliPhone, normalizeIsraeliPhone } from '@/utils/phoneUtils';
import { LEAD_STATUS_OPTIONS } from '@/constants/leadOptions';
import { findLeadsByPhone } from '@/lib/phoneLookup';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessSalesWorkspace, isAdmin as isAdminUser } from '@/lib/rbac';

const LEAD_STATUS_LABELS = Object.fromEntries(LEAD_STATUS_OPTIONS.map((o) => [o.value, o.label]));

export default function NewLead({ asDialog = false, dialogPhone = null, onDialogClose = null }) {
  const navigate = useNavigate();
  const { user, effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  // In dialog mode the phone is seeded from a prop (e.g. "no match — create
  // this number") and on success we hand the new lead back instead of navigating.
  const initialPhone = dialogPhone || new URLSearchParams(window.location.search).get('phone') || '';
  const [formData, setFormData] = useState({
    full_name: '',
    phone: initialPhone,
    email: '',
    city: '',
    address: '',
    source: 'digital',
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    preferred_product: '',
    budget: '',
    notes: '',
    // 'new_lead' is the canonical value. This used to be 'new', which isn't in
    // LEAD_STATUS_OPTIONS at all — so a manually created lead was invisible to
    // the "משויך ולא טופל" tile and fell into the "בטיפול" bucket instead.
    status: 'new_lead',
  });

  // Live "this number already exists" check. Debounced, only once the number is
  // actually valid, and matched on the canonical phone key — so it catches a
  // lead that was saved in another format (webhook / sheet import) too.
  const [debouncedPhone, setDebouncedPhone] = useState('');
  const [dupAcknowledged, setDupAcknowledged] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedPhone(formData.phone), 300);
    return () => clearTimeout(t);
  }, [formData.phone]);

  const { data: duplicates = [] } = useQuery({
    queryKey: ['newLeadDuplicateCheck', normalizeIsraeliPhone(debouncedPhone)],
    enabled: isValidIsraeliPhone(debouncedPhone),
    staleTime: 30_000,
    queryFn: () => findLeadsByPhone(base44.supabase, debouncedPhone, { limit: 5 }),
  });

  const createLeadMutation = useMutation({
    mutationFn: async (data) => {
      // Create lead with owner set to admin (current user if admin, otherwise null)
      const leadData = {
        ...data,
        owner: isAdminUser(effectiveUser) ? effectiveUser.email : null,
        budget: data.budget ? parseFloat(data.budget) : null,
        effective_sort_date: new Date().toISOString(),
      };
      
      const lead = await base44.entities.Lead.create(leadData);

      // Audit log - lead created (task will be created by cloud function only if rep1 is set)
      await createAuditLog({
        leadId: lead.id,
        actionType: 'created',
        description: `ליד חדש נוצר: ${data.full_name}`,
        user: user || effectiveUser,
      });

      return lead;
    },
    onSuccess: (lead) => {
      if (asDialog && onDialogClose) { onDialogClose(lead); return; }
      navigate(createPageUrl('LeadDetails') + `?id=${lead.id}`);
    },
    // Without this a failed insert (RLS denial, a rejected column) left "שמור
    // ליד" doing nothing. Surface the real PostgREST error so the rep sees it.
    onError: (err) => {
      const parts = [err?.message, err?.details, err?.hint, err?.code]
        .map((p) => (p == null || p === '' ? null : String(p)))
        .filter(Boolean);
      const description = parts.length ? parts.join(' — ') : (typeof err === 'string' ? err : 'אירעה שגיאה לא ידועה');
      console.error('Lead.create failed', { message: err?.message, details: err?.details, hint: err?.hint, code: err?.code, raw: err });
      toast.error(`יצירת הליד נכשלה: ${description}`, { duration: Infinity });
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isValidIsraeliPhone(formData.phone)) {
      // Browser-native required already caught empty; this guards format.
      return;
    }
    // A lead with this number already exists → don't create a second copy of
    // the same customer silently. First submit explains and offers the existing
    // record; a second submit is the explicit "create anyway".
    if (duplicates.length > 0 && !dupAcknowledged) {
      setDupAcknowledged(true);
      toast.error(
        `קיים כבר ליד עם הטלפון הזה (${duplicates[0].full_name || 'ללא שם'}). ` +
        'פתח את הליד הקיים, או לחץ "צור בכל זאת" כדי ליצור רשומה נוספת.',
        { duration: 12_000 },
      );
      return;
    }
    createLeadMutation.mutate(formData);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Changing the number invalidates a previous "create anyway" decision.
    if (field === 'phone') setDupAcknowledged(false);
  };

  if (isLoadingUser) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (!canAccessSalesWorkspace(effectiveUser)) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה ליצור ליד חדש</p>
        <Link to={createPageUrl('Leads')}>
          <Button className="mt-4">חזור ללידים</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className={asDialog ? 'space-y-6' : 'max-w-3xl mx-auto space-y-6'}>
      {!asDialog && (
        <div className="flex items-center gap-4">
          <Link to={createPageUrl('Leads')}>
            <Button variant="ghost" size="icon">
              <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">ליד חדש</h1>
            <p className="text-muted-foreground">הוסף ליד חדש למערכת</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>פרטי לקוח</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="full_name">שם מלא *</Label>
                <Input
                  id="full_name"
                  value={formData.full_name}
                  onChange={(e) => handleChange('full_name', e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">טלפון *</Label>
                <IsraeliPhoneInput
                  id="phone"
                  value={formData.phone}
                  onChange={(value) => handleChange('phone', value)}
                  required
                />
              </div>

              {/* Same number already in the system — surfaced before saving, not
                  discovered later as two half-worked copies of one customer. */}
              {duplicates.length > 0 ? (
                <div className="sm:col-span-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2.5 space-y-2">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    {duplicates.length === 1
                      ? 'קיים כבר ליד עם מספר הטלפון הזה'
                      : `קיימים ${duplicates.length} לידים עם מספר הטלפון הזה`}
                  </p>
                  <div className="space-y-1.5">
                    {duplicates.map((dup) => (
                      <div key={dup.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-1.5">
                        <div className="text-xs">
                          <span className="font-medium">{dup.full_name || 'ללא שם'}</span>
                          {dup.phone ? <span className="opacity-70" dir="ltr"> · {dup.phone}</span> : null}
                          {dup.status ? <span className="opacity-70"> · {LEAD_STATUS_LABELS[dup.status] || dup.status}</span> : null}
                        </div>
                        <Link
                          to={createPageUrl('LeadDetails') + `?id=${dup.id}`}
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          פתח את הליד הקיים
                        </Link>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] opacity-80">
                    עדיף להמשיך לעבוד על הרשומה הקיימת — כך ההיסטוריה, ההצעות והמשימות נשארות במקום אחד.
                  </p>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="email">אימייל</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">עיר</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => handleChange('city', e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">כתובת מלאה</Label>
              <AddressAutocomplete
                id="address"
                value={formData.address}
                onChange={(value, details) => {
                  handleChange('address', value);
                  // If the user picked a suggestion, also fill the city field
                  // so we don't end up with mismatched address/city pairs.
                  if (details?.city) handleChange('city', details.city);
                }}
                placeholder="התחל להקליד וכתובת תושלם אוטומטית..."
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>מקור ופרטי מעקב</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="source">מקור הליד</Label>
                <Select 
                  value={formData.source} 
                  onValueChange={(value) => handleChange('source', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="store">חנות</SelectItem>
                    <SelectItem value="callcenter">מוקד טלפוני</SelectItem>
                    <SelectItem value="digital">דיגיטל</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="referral">הפניה</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="preferred_product">מוצר מועדף</Label>
                <Input
                  id="preferred_product"
                  value={formData.preferred_product}
                  onChange={(e) => handleChange('preferred_product', e.target.value)}
                  placeholder="לדוגמה: מזרן קינג דוד פרימיום"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="budget">תקציב משוער</Label>
                <Input
                  id="budget"
                  type="number"
                  value={formData.budget}
                  onChange={(e) => handleChange('budget', e.target.value)}
                  placeholder="₪"
                />
              </div>
            </div>

            <div className="border-t pt-4 space-y-3">
              <p className="text-sm font-medium text-foreground/80">מידע שיווקי</p>
              <LeadMarketingSection data={formData} onChange={handleChange} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">הערות</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => handleChange('notes', e.target.value)}
                rows={3}
                placeholder="מידע נוסף על הליד..."
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 mt-6">
          {asDialog ? (
            <Button type="button" variant="outline" onClick={() => onDialogClose?.(null)}>ביטול</Button>
          ) : (
            <Link to={createPageUrl('Leads')}>
              <Button type="button" variant="outline">ביטול</Button>
            </Link>
          )}
          <Button
            type="submit" 
            className=""
            disabled={createLeadMutation.isPending}
          >
            {createLeadMutation.isPending ? (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 me-2" />
            )}
            {duplicates.length > 0 && dupAcknowledged ? 'צור בכל זאת' : 'שמור ליד'}
          </Button>
        </div>
      </form>
    </div>
  );
}