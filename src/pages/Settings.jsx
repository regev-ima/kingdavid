import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Save, Users, Settings as SettingsIcon, MessageCircle, Phone, ListChecks, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
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
import UserAvatar from "@/components/shared/UserAvatar";
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { canAccessAdminOnly } from '@/lib/rbac';

export default function Settings() {
  const { getEffectiveUser, isImpersonating } = useImpersonation();
  const [user, setUser] = useState(null);
  const [profileData, setProfileData] = useState({ full_name: '' });
  const [voicecenterData, setVoicecenterData] = useState({ username: '', password: '' });
  const queryClient = useQueryClient();

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me();
        setUser(userData);
        setProfileData({ full_name: userData.full_name || '' });
        setVoicecenterData({ 
          username: userData.voicenter_username || '', 
          password: '' 
        });
      } catch (err) {}
    };
    fetchUser();
  }, []);

  const effectiveUser = getEffectiveUser(user);
  const isAdmin = canAccessAdminOnly(effectiveUser);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    enabled: isAdmin,
  });

  const updateProfileMutation = useMutation({
    mutationFn: (data) => base44.auth.updateMe(data),
    onSuccess: (updatedUser) => {
      setUser(updatedUser);
      toast.success('הפרטים עודכנו בהצלחה');
    },
  });

  const saveVoicecenterMutation = useMutation({
    mutationFn: async (data) => {
      const response = await base44.functions.invoke('saveVoicecenterCredentials', data);
      return response.data;
    },
    onSuccess: async () => {
      const updatedUser = await base44.auth.me();
      setUser(updatedUser);
      setVoicecenterData({ username: updatedUser.voicenter_username || '', password: '' });
      toast.success('פרטי VoiceCenter נשמרו בהצלחה');
    },
    onError: (error) => {
      toast.error('שגיאה בשמירת הפרטים: ' + error.message);
    }
  });

  const roleLabels = {
    admin: 'מנהל מערכת (ADMIN)',
    sales_user: 'נציג מכירות (SALES_USER)',
    factory_user: 'נציג מפעל (FACTORY_USER)'
  };

  const handleInviteUser = async (email, role) => {
    try {
      const result = await base44.users.inviteUser(email, role);
      queryClient.invalidateQueries(['users']);
      toast.success(result?.already_registered ? 'המשתמש כבר רשום — הפרופיל עודכן' : 'ההזמנה נשלחה במייל');
    } catch (err) {
      toast.error(`שליחת ההזמנה נכשלה: ${err?.message || 'שגיאה לא ידועה'}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">הגדרות</h1>
        <p className="text-muted-foreground">ניהול חשבון והעדפות מערכת</p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="bg-white border">
          <TabsTrigger value="profile" className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" />
            פרופיל
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              משתמשים
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="statuses" className="flex items-center gap-2">
              <ListChecks className="h-4 w-4" />
              סטטוסים
            </TabsTrigger>
          )}
        </TabsList>

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
              <CardTitle>הגדרות VoiceCenter</CardTitle>
              <CardDescription>התחבר למערכת ה-VoiceCenter שלך לתיעוד שיחות אוטומטי</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                הזן את פרטי ההתחברות שלך ל-VoiceCenter כדי לאפשר תיעוד שיחות אוטומטי ופופ-אפ למידע על לקוחות בזמן שיחה.
              </p>
              
              {user?.voicenter_username && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
                  <Phone className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-green-700">מחובר כ-{user.voicenter_username}</span>
                </div>
              )}

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>שם משתמש VoiceCenter</Label>
                  <Input
                    type="text"
                    value={voicecenterData.username}
                    onChange={(e) => setVoicecenterData({...voicecenterData, username: e.target.value})}
                    placeholder="שם המשתמש שלך ב-VoiceCenter"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>סיסמה</Label>
                  <Input
                    type="password"
                    value={voicecenterData.password}
                    onChange={(e) => setVoicecenterData({...voicecenterData, password: e.target.value})}
                    placeholder="הסיסמה שלך ב-VoiceCenter"
                  />
                  <p className="text-xs text-muted-foreground">הסיסמה תישמר מוצפנת במערכת</p>
                </div>
              </div>

              <Button 
                onClick={() => saveVoicecenterMutation.mutate(voicecenterData)}
                disabled={isImpersonating || saveVoicecenterMutation.isPending || !voicecenterData.username || !voicecenterData.password}
                className="bg-primary hover:bg-primary/90"
              >
                {saveVoicecenterMutation.isPending ? (
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 me-2" />
                )}
                שמור פרטי VoiceCenter
              </Button>
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
            <Card>
              <CardHeader>
                <CardTitle>ניהול משתמשים</CardTitle>
                <CardDescription>הזמן משתמשים חדשים ונהל הרשאות</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="p-4 bg-muted rounded-lg">
                  <h3 className="font-semibold mb-3">הזמן משתמש חדש</h3>
                  <div className="flex gap-3">
                    <Input
                      id="invite-email"
                      placeholder="אימייל"
                      className="flex-1"
                    />
                    <select
                      id="invite-role"
                      className="px-3 py-2 border rounded-md"
                      defaultValue="sales_user"
                    >
                      <option value="admin">מנהל מערכת</option>
                      <option value="sales_user">נציג מכירות</option>
                      <option value="factory_user">נציג מפעל</option>
                    </select>
                    <Button
                      onClick={() => {
                        const email = document.getElementById('invite-email').value;
                        const role = document.getElementById('invite-role').value;
                        if (email) handleInviteUser(email, role);
                      }}
                      className="bg-primary hover:bg-primary/90"
                    >
                      הזמן
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-semibold">משתמשים קיימים ({users.length})</h3>
                  <div className="space-y-3">
                    {users.map(u => (
                      <div key={u.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <UserAvatar user={u} size="md" />
                          <div>
                            <p className="font-medium">{u.full_name || 'ללא שם'}</p>
                            <p className="text-sm text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 
                          u.role === 'sales_user' ? 'bg-blue-100 text-blue-700' : 
                          'bg-green-100 text-green-700'
                        }`}>
                          {roleLabels[u.role] || u.role}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="statuses">
            <StatusManagement />
          </TabsContent>
        )}
      </Tabs>
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
