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
import { ArrowRight, Save, Loader2 } from "lucide-react";
import { Link, useNavigate } from 'react-router-dom';
import LeadMarketingSection from '@/components/lead/LeadMarketingSection';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { canAccessSalesWorkspace, isAdmin as isAdminUser } from '@/lib/rbac';

export default function NewLead() {
  const navigate = useNavigate();
  const { user, effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
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
      navigate(createPageUrl('LeadDetails') + `?id=${lead.id}`);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
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
    <div className="max-w-3xl mx-auto space-y-6">
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
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  required
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
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => handleChange('address', e.target.value)}
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
          <Link to={createPageUrl('Leads')}>
            <Button type="button" variant="outline">ביטול</Button>
          </Link>
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
      </form>
    </div>
  );
}