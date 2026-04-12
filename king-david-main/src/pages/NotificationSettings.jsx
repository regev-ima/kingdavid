import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Bell, Save, AlertTriangle } from "lucide-react";
import { toast } from 'react-hot-toast';

export default function NotificationSettings() {
  const [user, setUser] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me();
        setUser(userData);
      } catch (err) {
        console.error('Error fetching user:', err);
      }
    };
    fetchUser();
  }, []);

  const { data: preferences, isLoading } = useQuery({
    queryKey: ['notificationPreferences', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const prefs = await base44.entities.NotificationPreferences.filter({ user_id: user.id });
      return prefs.length > 0 ? prefs[0] : null;
    },
    enabled: !!user?.id,
  });

  const [settings, setSettings] = useState({
    task_reminders: true,
    sla_alerts: true,
    inventory_alerts: true,
    support_ticket_alerts: true,
    order_status_alerts: true,
    new_lead_alerts: true,
    quote_expiring_alerts: true,
    return_request_alerts: true,
  });

  useEffect(() => {
    if (preferences) {
      setSettings({
        task_reminders: preferences.task_reminders ?? true,
        sla_alerts: preferences.sla_alerts ?? true,
        inventory_alerts: preferences.inventory_alerts ?? true,
        support_ticket_alerts: preferences.support_ticket_alerts ?? true,
        order_status_alerts: preferences.order_status_alerts ?? true,
        new_lead_alerts: preferences.new_lead_alerts ?? true,
        quote_expiring_alerts: preferences.quote_expiring_alerts ?? true,
        return_request_alerts: preferences.return_request_alerts ?? true,
      });
    }
  }, [preferences]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (preferences) {
        await base44.entities.NotificationPreferences.update(preferences.id, data);
      } else {
        await base44.entities.NotificationPreferences.create({
          user_id: user.id,
          ...data,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['notificationPreferences']);
      toast.success('ההגדרות נשמרו בהצלחה');
    },
    onError: (error) => {
      toast.error('שגיאה בשמירת ההגדרות');
      console.error('Error saving preferences:', error);
    },
  });

  const handleToggle = (field) => {
    setSettings(prev => ({ ...prev, [field]: !prev[field] }));
  };

  const handleSave = () => {
    saveMutation.mutate(settings);
  };

  const notificationTypes = [
    {
      key: 'task_reminders',
      title: 'תזכורות למשימות',
      description: 'קבל התראות כאשר משימה מתקרבת למועד היעד או עברה אותו',
    },
    {
      key: 'sla_alerts',
      title: 'התראות SLA',
      description: 'קבל התראות כאשר ליד חורג מזמני התגובה המוגדרים',
    },
    {
      key: 'inventory_alerts',
      title: 'התראות מלאי נמוך',
      description: 'קבל התראות כאשר מלאי של פריט יורד מתחת לסף המינימום',
    },
    {
      key: 'support_ticket_alerts',
      title: 'טיקטי שירות חדשים',
      description: 'קבל התראות על קריאות שירות חדשות שמשויכות אליך',
    },
    {
      key: 'order_status_alerts',
      title: 'שינויי סטטוס הזמנות',
      description: 'קבל התראות כאשר סטטוס הזמנה משתנה',
    },
    {
      key: 'new_lead_alerts',
      title: 'לידים חדשים',
      description: 'קבל התראות כאשר ליד חדש משויך אליך',
    },
    {
      key: 'quote_expiring_alerts',
      title: 'הצעות מחיר שפוגות',
      description: 'קבל התראות כאשר הצעת מחיר עומדת לפוג',
    },
    {
      key: 'return_request_alerts',
      title: 'בקשות החזרה',
      description: 'קבל התראות על בקשות החזרה חדשות',
    },
  ];

  if (isLoading || !user) {
    return <div className="text-center py-12">טוען...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">הגדרות התראות</h1>
          <p className="text-muted-foreground mt-1">נהל את סוגי ההתראות שאתה מעוניין לקבל</p>
        </div>
        <Bell className="h-8 w-8 text-primary" />
      </div>

      <Card className="border-amber-200 bg-amber-50/30">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-900">שים לב</p>
              <p className="text-sm text-amber-700">
                ההתראות מוצגות בפעמון בראש המסך. כיבוי התראות מסוימות ימנע את יצירתן במערכת.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>סוגי התראות</CardTitle>
          <CardDescription>
            בחר אילו סוגי התראות תרצה לקבל במערכת
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {notificationTypes.map((type) => (
            <div key={type.key} className="flex items-start justify-between gap-4 pb-6 border-b last:border-b-0 last:pb-0">
              <div className="flex-1">
                <h4 className="font-medium text-foreground mb-1">{type.title}</h4>
                <p className="text-sm text-muted-foreground">{type.description}</p>
              </div>
              <Switch
                checked={settings[type.key]}
                onCheckedChange={() => handleToggle(type.key)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button 
          onClick={handleSave} 
          disabled={saveMutation.isPending}
          className="bg-primary hover:bg-primary/90"
        >
          <Save className="h-4 w-4 me-2" />
          {saveMutation.isPending ? 'שומר...' : 'שמור הגדרות'}
        </Button>
      </div>
    </div>
  );
}