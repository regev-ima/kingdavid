import React, { useState, useEffect, lazy, Suspense } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Loader2, Save, MessageCircle, Phone, Eye, EyeOff, Plus, Trash2, ShoppingCart, Upload } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useHiddenStatuses } from '@/hooks/useHiddenStatuses';
import { useCustomStatuses } from '@/hooks/useCustomStatuses';
import { useStatusColors } from '@/hooks/useStatusColors';
import { LEAD_STATUS_OPTIONS } from '@/constants/leadOptions';
import { STATUS_COLOR_PRESETS, getStatusColorPreset } from '@/constants/statusColors';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import StatusBadge from '@/components/shared/StatusBadge';
import ProfileAvatarPicker from "@/components/shared/ProfileAvatarPicker";
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { canAccessAdminOnly, canUseBulkUpdate } from '@/lib/rbac';

// Each settings section is code-split and loaded only when its card is opened,
// so the cards "home" (and the whole screen) loads fast instead of bundling
// the Representatives page, BulkUpdate, the drag-drop menu lib, etc. up front.
const ImportOrders = lazy(() => import('@/components/service/ImportOrders'));
const QuoteDefaultsTab = lazy(() => import('@/components/settings/QuoteDefaultsTab'));
const CompanyClosuresTab = lazy(() => import('@/components/settings/CompanyClosuresTab'));
const Sms019SettingsTab = lazy(() => import('@/components/settings/Sms019SettingsTab'));
const BulkUpdate = lazy(() => import('@/pages/BulkUpdate'));
const Representatives = lazy(() => import('@/pages/Representatives'));
const MenuManagementTab = lazy(() => import('@/components/settings/MenuManagementTab'));
const LeadSourcesTab = lazy(() => import('@/components/settings/LeadSourcesTab'));

// Centered spinner shown while a section's chunk downloads.
function SectionFallback() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function Settings() {
  const { getEffectiveUser, isImpersonating } = useImpersonation();
  const [user, setUser] = useState(null);
  const [profileData, setProfileData] = useState({ full_name: '' });
  const [showImportOrders, setShowImportOrders] = useState(false);
  // Settings nav is a card grid: null = the cards "home", otherwise the open section.
  const [section, setSection] = useState(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me();
        setUser(userData);
        setProfileData({ full_name: userData.full_name || '' });
      } catch (err) {}
    };
    fetchUser();
  }, []);

  const effectiveUser = getEffectiveUser(user);
  const isAdmin = canAccessAdminOnly(effectiveUser);
  const canBulkUpdate = canUseBulkUpdate(effectiveUser);

  const updateProfileMutation = useMutation({
    mutationFn: (data) => base44.auth.updateMe(data),
    onSuccess: (updatedUser) => {
      setUser(updatedUser);
      toast.success('הפרטים עודכנו בהצלחה');
    },
  });

  const roleLabels = {
    admin: 'מנהל מערכת (ADMIN)',
    sales_user: 'נציג מכירות (SALES_USER)',
    factory_user: 'נציג מפעל (FACTORY_USER)'
  };

  // The settings sections, shown as cards on the "home" and gated by role.
  // `icon` is a Google Material Symbols ligature name.
  const SETTINGS_SECTIONS = [
    { value: 'profile',        label: 'פרופיל',            desc: 'פרטי החשבון והתראות',       icon: 'account_circle', show: true },
    { value: 'users',          label: 'נציגים',            desc: 'ניהול צוות המכירות, הזמנות והרשאות', icon: 'group',     show: isAdmin },
    { value: 'statuses',       label: 'סטטוסים',           desc: 'ניהול סטטוסי לידים',         icon: 'checklist',      show: isAdmin },
    { value: 'lead-sources',   label: 'מקורות הגעה',        desc: 'אייקונים למקורות הלידים',    icon: 'ads_click',      show: isAdmin },
    { value: 'import',         label: 'ייבוא נתונים',       desc: 'ייבוא הזמנות מקבצים',        icon: 'upload_file',    show: isAdmin },
    { value: 'quote-defaults', label: 'ברירות-מחדל הצעה',  desc: 'טקסטים ותנאים קבועים',      icon: 'receipt_long',   show: isAdmin },
    { value: 'closures',       label: 'ימי סגירה',         desc: 'חגים וימי אי-פעילות',        icon: 'event_busy',     show: isAdmin },
    { value: 'sms',            label: 'שליחת SMS',         desc: 'חיבור חשבון 019',           icon: 'sms',            show: isAdmin },
    { value: 'bulk',           label: 'עדכון המוני',        desc: 'עדכון נתונים בכמות',         icon: 'sync',           show: canBulkUpdate },
    { value: 'menu',           label: 'תפריט',             desc: 'הסתרה וסידור התפריט',        icon: 'menu',           show: isAdmin },
  ].filter((s) => s.show);
  const activeSection = SETTINGS_SECTIONS.find((s) => s.value === section);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">הגדרות</h1>
        <p className="text-muted-foreground">{section === null ? 'בחר אזור לניהול' : (activeSection?.desc || 'ניהול חשבון והעדפות מערכת')}</p>
      </div>

      {/* dir="rtl" is required here: Radix Tabs defaults its direction to "ltr"
          and stamps dir="ltr" on the wrapper around BOTH the tab row and all
          tab content, which overrides the page's inherited RTL (tabs reversed,
          content left-aligned, switch thumbs flipped). */}
      {/* Card-grid navigation: the "home" shows a card per section; opening one
          drives the controlled Tabs value so the matching content renders, with
          a back link to return to the grid. dir="rtl" on Tabs is required —
          Radix stamps dir="ltr" on its wrapper otherwise. */}
      <Tabs value={section || ''} onValueChange={setSection} className="space-y-6" dir="rtl">
        {section === null ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {SETTINGS_SECTIONS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSection(s.value)}
                className="text-right rounded-xl border border-border bg-card p-4 shadow-card transition-all hover:border-primary hover:shadow-lg hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span
                  className="material-symbols-outlined mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"
                  style={{ fontSize: '24px' }}
                  aria-hidden="true"
                >
                  {s.icon}
                </span>
                <p className="font-semibold text-foreground">{s.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSection(null)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }} aria-hidden="true">arrow_forward</span>
            חזרה להגדרות
          </button>
        )}

        <TabsContent value="profile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>פרטי פרופיל</CardTitle>
              <CardDescription>עדכן את פרטי החשבון שלך</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4">
                <ProfileAvatarPicker 
                  user={isImpersonating ? effectiveUser : user} 
                  onUpdate={async () => {
                    const updated = await base44.auth.me();
                    setUser(updated);
                  }} 
                />
                <div>
                  <p className="font-semibold text-lg">{(isImpersonating ? effectiveUser : user)?.full_name}</p>
                  <p className="text-muted-foreground">{(isImpersonating ? effectiveUser : user)?.email}</p>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    effectiveUser?.role === 'admin' ? 'bg-purple-100 text-purple-700' : 
                    effectiveUser?.role === 'sales_user' ? 'bg-blue-100 text-blue-700' : 
                    'bg-green-100 text-green-700'
                  }`}>
                    {roleLabels[effectiveUser?.role] || effectiveUser?.role}
                  </span>
                </div>
              </div>

              {isImpersonating && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  מצב התחזות: פעולות בדף ההגדרות עדיין פועלות עם החשבון האמיתי שלך, לכן הדף כאן מוצג לקריאה בלבד.
                </div>
              )}

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>שם מלא</Label>
                  <Input
                    value={profileData.full_name}
                    onChange={(e) => setProfileData({...profileData, full_name: e.target.value})}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>אימייל</Label>
                  <Input value={user?.email || ''} disabled className="bg-muted" />
                  <p className="text-xs text-muted-foreground">לא ניתן לשנות את כתובת האימייל</p>
                </div>
              </div>

              <Button 
                onClick={() => updateProfileMutation.mutate(profileData)}
                disabled={updateProfileMutation.isPending || isImpersonating}
                className="bg-primary hover:bg-primary/90"
              >
                {updateProfileMutation.isPending ? (
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 me-2" />
                )}
                שמור שינויים
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>התראות Push</CardTitle>
              <CardDescription>קבל התראות על לידים חדשים, משימות באיחור ועוד</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {typeof Notification !== 'undefined' && Notification.permission === 'granted' ? (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
                  <span className="text-green-600">✓</span>
                  <span className="text-sm text-green-700">התראות Push מופעלות במכשיר זה</span>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    הפעל התראות Push כדי לקבל עדכונים בזמן אמת גם כשהאפליקציה סגורה.
                  </p>
                  <Button
                    onClick={async () => {
                      try {
                        const { requestNotificationPermission } = await import('@/lib/firebase');
                        await requestNotificationPermission(user?.id);
                        toast.success('התראות הופעלו בהצלחה!');
                      } catch (err) {
                        toast.error('שגיאה בהפעלת התראות');
                      }
                    }}
                    className="bg-primary hover:bg-primary/90"
                  >
                    🔔 הפעל התראות Push
                  </Button>
                </>
              )}
              <p className="text-xs text-muted-foreground">
                * יש להפעיל בנפרד בכל מכשיר (מחשב, נייד)
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>VoiceCenter</CardTitle>
              <CardDescription>חיבור למערכת VoiceCenter לתיעוד שיחות ופופ-אפ אוטומטי</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                החיבור ל-VoiceCenter מנוהל ברמת המערכת. אין צורך בהזדהות אישית.
              </p>
              {user?.voicenter_extension ? (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
                  <Phone className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-green-700">משויך לשלוחה {user.voicenter_extension}</span>
                </div>
              ) : (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                  לא משויכת אליך שלוחת VoiceCenter. פנה למנהל המערכת כדי לעדכן את מספר השלוחה שלך בעמוד "נציגים".
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>סוכן מכירות בוואטסאפ</CardTitle>
              <CardDescription>התחבר לסוכן המכירות החכם דרך וואטסאפ</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                התחבר לסוכן המכירות שלנו דרך וואטסאפ כדי לנהל לידים ומשימות בנוחות מהנייד.
                הסוכן יכול לעזור לך לעדכן סטטוס לידים, ליצור משימות, לסכם שיחות ולקבל המלצות.
              </p>
              <a 
                href={base44.agents.getWhatsAppConnectURL('sales_assistant')} 
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button className="bg-green-600 hover:bg-green-700">
                  <MessageCircle className="h-4 w-4 me-2" />
                  התחבר לוואטסאפ
                </Button>
              </a>
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="users">
            {/* The full Representatives screen, embedded — single source of truth
                for managing the sales team (was duplicated as a weaker tab). */}
            <Suspense fallback={<SectionFallback />}>
              <Representatives embedded />
            </Suspense>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="statuses">
            <StatusManagement />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="lead-sources">
            <Suspense fallback={<SectionFallback />}>
              <LeadSourcesTab />
            </Suspense>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="import" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  ייבוא הזמנות מהעבר
                </CardTitle>
                <CardDescription>
                  ייבוא הזמנות ישנות מקובץ CSV / Excel. ההזמנות יסומנו בתג ״הזמנה מיובאת״,
                  וניתן יהיה לקשר אליהן פניות שירות לפי מספר ההזמנה.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => setShowImportOrders(true)} className="gap-2">
                  <Upload className="h-4 w-4" />
                  ייבוא הזמנות
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="quote-defaults" className="space-y-6">
            <Suspense fallback={<SectionFallback />}>
              <QuoteDefaultsTab />
            </Suspense>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="closures" className="space-y-6">
            <Suspense fallback={<SectionFallback />}>
              <CompanyClosuresTab />
            </Suspense>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="sms" className="space-y-6">
            <Suspense fallback={<SectionFallback />}>
              <Sms019SettingsTab />
            </Suspense>
          </TabsContent>
        )}

        {canBulkUpdate && (
          <TabsContent value="bulk" className="space-y-6">
            <Suspense fallback={<SectionFallback />}>
              <BulkUpdate />
            </Suspense>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="menu" className="space-y-6">
            <Suspense fallback={<SectionFallback />}>
              <MenuManagementTab />
            </Suspense>
          </TabsContent>
        )}
      </Tabs>

      {isAdmin && showImportOrders && (
        <Suspense fallback={null}>
          <ImportOrders open={showImportOrders} onOpenChange={setShowImportOrders} />
        </Suspense>
      )}
    </div>
  );
}

function StatusColorPicker({ value, onChange }) {
  const current = getStatusColorPreset(value);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-7 w-7 rounded-full border border-border/60 hover:border-primary/60 transition-colors flex items-center justify-center"
          aria-label="בחר צבע לסטטוס"
        >
          <span
            className={`block h-4 w-4 rounded-full ${current ? current.dot : 'bg-gradient-to-br from-slate-300 to-slate-500'}`}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="grid grid-cols-6 gap-1.5">
          {STATUS_COLOR_PRESETS.map((preset) => {
            const isActive = preset.id === value;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChange(preset.id)}
                className={`h-7 w-7 rounded-full ${preset.dot} flex items-center justify-center transition-all ${
                  isActive ? 'ring-2 ring-offset-1 ring-primary scale-110' : 'hover:scale-110'
                }`}
                title={preset.label}
                aria-label={preset.label}
              />
            );
          })}
        </div>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground py-1 border-t border-border/40 pt-2"
          >
            איפוס לצבע ברירת המחדל
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function StatusManagement() {
  const { hiddenStatuses, isLoading, setHiddenStatuses, isPending } = useHiddenStatuses();
  const { customStatuses, addStatus, removeStatus } = useCustomStatuses();
  const { statusColors, setStatusColor } = useStatusColors();
  const [newStatusLabel, setNewStatusLabel] = useState('');

  const handleAddStatus = (e) => {
    e?.preventDefault?.();
    const label = newStatusLabel.trim();
    if (!label) return;
    const created = addStatus(label);
    if (!created) {
      toast.error('סטטוס בשם הזה כבר קיים');
      return;
    }
    setNewStatusLabel('');
    toast.success(`הסטטוס "${label}" נוסף`);
  };

  const handleRemoveCustom = (status) => {
    if (!confirm(`למחוק את הסטטוס "${status.label}"? לידים שכבר נמצאים בסטטוס הזה לא יושפעו.`)) return;
    removeStatus(status.value);
    // Drop any "hidden" entry that was hiding the now-deleted status.
    if (hiddenStatuses.includes(status.value)) {
      setHiddenStatuses(hiddenStatuses.filter((s) => s !== status.value));
    }
    toast.success(`הסטטוס "${status.label}" נמחק`);
  };

  const toggleStatus = (statusValue) => {
    const newList = hiddenStatuses.includes(statusValue)
      ? hiddenStatuses.filter(s => s !== statusValue)
      : [...hiddenStatuses, statusValue];
    setHiddenStatuses(newList);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>ניהול סטטוסים</CardTitle>
        <CardDescription>
          הסתר סטטוסים כדי שנציגים לא יוכלו לבחור אותם. לידים שכבר נמצאים בסטטוס מוסתר ימשיכו להציג אותו.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Add-status row — always visible at the top so the action is
                obvious. Submitting an empty / duplicate label just no-ops
                with a toast (handled in handleAddStatus). */}
            <form
              onSubmit={handleAddStatus}
              className="flex gap-2 items-center pb-3 border-b border-border/40"
            >
              <Input
                value={newStatusLabel}
                onChange={(e) => setNewStatusLabel(e.target.value)}
                placeholder="שם סטטוס חדש (למשל: 'נשלח חוזה לחתימה')"
                className="flex-1"
              />
              <Button type="submit" disabled={!newStatusLabel.trim()}>
                <Plus className="h-4 w-4 me-2" />
                הוסף סטטוס
              </Button>
            </form>

            <div className="space-y-1">
              {[
                ...LEAD_STATUS_OPTIONS.map((opt) => ({ ...opt, isCustom: false })),
                ...customStatuses.map((opt) => ({ ...opt, isCustom: true })),
              ].map((opt) => {
                const isHidden = hiddenStatuses.includes(opt.value);
                return (
                  <div
                    key={opt.value}
                    className={`flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${
                      isHidden ? 'bg-muted/50 opacity-60' : 'hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {isHidden ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <Eye className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                      )}
                      <div className={`flex items-center gap-2 min-w-0 ${isHidden ? 'opacity-60' : ''}`}>
                        <StatusBadge status={opt.value} label={opt.label} />
                        {opt.isCustom ? (
                          <span className="text-[10px] uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            מותאם
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusColorPicker
                        value={statusColors[opt.value]}
                        onChange={(presetId) => setStatusColor(opt.value, presetId)}
                      />
                      <Switch
                        checked={!isHidden}
                        onCheckedChange={() => toggleStatus(opt.value)}
                        disabled={isPending}
                      />
                      {opt.isCustom ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveCustom(opt)}
                          className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                          aria-label={`מחק סטטוס ${opt.label}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
