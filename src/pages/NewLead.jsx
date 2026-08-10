import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation } from '@tanstack/react-query';
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
import { ArrowRight, Save, Loader2, UserCheck } from "lucide-react";
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import LeadMarketingSection from '@/components/lead/LeadMarketingSection';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import IsraeliPhoneInput from '@/components/shared/IsraeliPhoneInput';
import { isValidIsraeliPhone } from '@/utils/phoneUtils';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessSalesWorkspace, isAdmin as isAdminUser } from '@/lib/rbac';
import { LEAD_SOURCE_OPTIONS } from '@/constants/leadOptions';

export default function NewLead({ asDialog = false, dialogPhone = null, onDialogClose = null }) {
  const navigate = useNavigate();
  const { user, effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  // In dialog mode the phone is seeded from a prop (e.g. "no match — create
  // this number") and on success we hand the new lead back instead of navigating.
  const initialPhone = dialogPhone || new URLSearchParams(window.location.search).get('phone') || '';
  const [formData, setFormData] = useState({
    full_name: '',
    phone: initialPhone,
    // Second number, optional. Follows the lead into the quote, the order and
    // the customer record — it's usually the number that matters at delivery.
    phone_2: '',
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
    status: 'new',
  });

  // A hand-typed lead belongs to whoever typed it — rep and manager alike.
  // Whoever fills this form is already the one talking to the customer, so the
  // lead goes straight into their book instead of landing in the admins'
  // "יש לשייך את הליד לנציג" queue just to be handed back to them. Matches what
  // /NewQuote already does when it creates a lead on the fly.
  const assignedRepEmail = effectiveUser?.email || null;
  const assignedRepName = effectiveUser?.full_name || assignedRepEmail;

  const createLeadMutation = useMutation({
    mutationFn: async (data) => {
      // `owner` is unchanged: the admin's email when an admin created it.
      const leadData = {
        ...data,
        rep1: assignedRepEmail,
        owner: isAdminUser(effectiveUser) ? effectiveUser.email : null,
        budget: data.budget ? parseFloat(data.budget) : null,
        effective_sort_date: new Date().toISOString(),
      };

      const lead = await base44.entities.Lead.create(leadData);

      // Audit log - lead created. The rep's follow-up call task is created by
      // the trackLeadAssignment automation, which fires on INSERT and sees rep1.
      await createAuditLog({
        leadId: lead.id,
        actionType: 'created',
        description: `ליד חדש נוצר: ${data.full_name}`,
        user: user || effectiveUser,
      });

      // Second entry, on purpose: the timeline should show the assignment the
      // same way it shows a manual one, so "מי הנציג ומאיפה הגיע" reads off the
      // lead's history without anyone having to know the lead was self-created.
      if (assignedRepEmail) {
        await createAuditLog({
          leadId: lead.id,
          actionType: 'rep_assigned',
          description: `הליד שויך אוטומטית ל${assignedRepName} — יוצר הליד`,
          user: user || effectiveUser,
          fieldName: 'rep1',
          oldValue: 'לא משויך',
          newValue: assignedRepEmail,
        });
      }

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
    createLeadMutation.mutate(formData);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
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
                <Label htmlFor="full_name">שם ושם משפחה *</Label>
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
              <div className="space-y-2">
                <Label htmlFor="phone_2">טלפון נוסף</Label>
                <IsraeliPhoneInput
                  id="phone_2"
                  value={formData.phone_2}
                  onChange={(value) => handleChange('phone_2', value)}
                />
              </div>
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
                    {/* Read from the shared list rather than repeated here.
                        This copy had already drifted — it was missing "אתר",
                        so a lead typed into this form could never carry the
                        source that the order dialog beside it offers. */}
                    {LEAD_SOURCE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
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

        <div className="flex flex-wrap items-center justify-between gap-3 mt-6">
          {assignedRepName ? (
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <UserCheck className="h-4 w-4" />
              הליד ישויך אוטומטית ל<span className="font-medium text-foreground">{assignedRepName}</span>
            </p>
          ) : <span />}
          <div className="flex gap-3 ms-auto">
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
              שמור ליד
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}