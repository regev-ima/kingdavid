import React, { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, ShieldCheck, TriangleAlert, Users } from 'lucide-react';
import PermissionTree, { groupKeys } from '@/components/permissions/PermissionTree';
import UserAvatar from '@/components/shared/UserAvatar';
import {
  usePermissions,
  SUPER_ADMIN_EXISTS_QUERY_KEY,
  SUPER_ADMIN_QUERY_KEY,
  isMissingSchemaError,
} from '@/hooks/usePermissions';
import { ROLE_PERMISSIONS_QUERY_KEY } from '@/hooks/useRolePermissions';
import {
  ACCESS_LEVELS,
  ACCESS_LEVEL_META,
  EDITABLE_ACCESS_LEVELS,
  PERMISSION_GROUPS,
  SOURCE,
  SOURCE_LABELS,
  hydrateRolePermissions,
  resolveForLevel,
} from '@/lib/permissions';

const REPS_QUERY_KEY = ['permissions-users'];
const SUPER_ADMIN_MEMBERS_QUERY_KEY = ['super-admin', 'members'];

/**
 * Every write on this screen needs the tables the migration creates. Before it
 * runs — a preview build, a fresh environment — PostgREST answers with things
 * like "Cannot coerce the result to a single JSON object", which tells the
 * reader nothing. Name the actual problem instead.
 */
function describeWriteFailure(err) {
  const message = err?.message || '';
  if (isMissingSchemaError(err) || /coerce the result to a single JSON object/i.test(message)) {
    return 'ההגדרות עוד לא הוקמו במסד הנתונים — ההגירה של מערכת ההרשאות תרוץ במיזוג לענף הראשי. עד אז אפשר לעיין במסך אבל לא לשמור.';
  }
  return `הפעולה נכשלה: ${message || 'שגיאה לא ידועה'}`;
}

/** Deep-ish clone of the matrix so edits never mutate the query cache. */
function cloneMatrix(matrix) {
  const out = {};
  for (const level of EDITABLE_ACCESS_LEVELS) out[level] = { ...(matrix?.[level] || {}) };
  return out;
}

/**
 * Key order in a plain object follows insertion, so toggling a permission and
 * then resetting it leaves an object with the same contents in a different
 * order. Comparing raw JSON would call that a change and leave the שמירה button
 * lit with nothing to save — sort first.
 */
function stableJson(levelMap) {
  const entries = Object.entries(levelMap || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

function countExplicit(levelMap) {
  return Object.keys(levelMap || {}).length;
}

export default function PermissionsTab() {
  const queryClient = useQueryClient();
  const {
    effectiveUser,
    matrix,
    isSuperAdmin,
    superAdminExists,
    canManagePermissions,
  } = usePermissions();

  const [level, setLevel] = useState(ACCESS_LEVELS.REP);
  const [draft, setDraft] = useState(null); // null = following the server value

  const serverMatrix = useMemo(() => cloneMatrix(matrix), [matrix]);
  const working = draft || serverMatrix;
  const changedLevels = EDITABLE_ACCESS_LEVELS.filter(
    (lvl) => stableJson(working[lvl]) !== stableJson(serverMatrix[lvl]),
  );
  const dirty = draft !== null && changedLevels.length > 0;

  const patch = useCallback(
    (mutate) => {
      setDraft((current) => {
        const next = cloneMatrix(current || serverMatrix);
        mutate(next);
        return next;
      });
    },
    [serverMatrix],
  );

  const getState = useCallback(
    (key) => {
      const resolved = resolveForLevel(level, key, working);
      const explicit = typeof working?.[level]?.[key] === 'boolean';
      return {
        allowed: resolved.allowed,
        explicit,
        blockedBy: resolved.blockedBy ?? null,
        sourceLabel: explicit ? null : SOURCE_LABELS[SOURCE.LEVEL_DEFAULT],
      };
    },
    [level, working],
  );

  const onToggle = useCallback(
    (key, value) => patch((next) => { next[level][key] = value; }),
    [level, patch],
  );

  const onReset = useCallback(
    (key) => patch((next) => { delete next[level][key]; }),
    [level, patch],
  );

  const onSetGroup = useCallback(
    (group, value) => patch((next) => {
      for (const key of groupKeys(group)) next[level][key] = value;
    }),
    [level, patch],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Only the levels that actually changed are written, so saving one level
      // never stamps updated_by over another's untouched row.
      for (const lvl of changedLevels) {
        await base44.entities.RolePermission.update(lvl, {
          permissions: working[lvl] || {},
          updated_date: new Date().toISOString(),
          updated_by: effectiveUser?.email || '',
        });
      }
      return working;
    },
    onSuccess: (saved) => {
      // Update the synchronous cache first, so every `can()` in the tree agrees
      // with the screen before the refetch lands.
      hydrateRolePermissions(saved);
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ROLE_PERMISSIONS_QUERY_KEY });
      toast.success('ההרשאות נשמרו');
    },
    onError: (err) => {
      toast.error(describeWriteFailure(err));
    },
  });

  if (!canManagePermissions) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>הרשאות ותפקידים</CardTitle>
          <CardDescription>
            עריכת מערכת ההרשאות שמורה לסופר אדמין בלבד. מי שיכול לערוך הרשאות יכול להעניק
            לעצמו כל דבר אחר, ולכן זו הרמה היחידה שמחזיקה את המפתח הזה.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const explicitCount = countExplicit(working[level]);

  return (
    <div className="space-y-6">
      {!superAdminExists ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-900">
            <p className="font-medium">עדיין לא הוגדר סופר אדמין</p>
            <p className="mt-0.5 text-xs leading-relaxed">
              כל עוד אין סופר אדמין במערכת, כל מנהל יכול לפתוח את המסך הזה. מומלץ למנות
              את נתנאל ורגב בלשונית ״סופר אדמין״ — מהרגע שיוגדר סופר אדמין אחד, המסך ננעל
              רק לרמה הזו.
            </p>
          </div>
        </div>
      ) : null}

      <Tabs defaultValue="matrix" dir="rtl" className="space-y-5">
        <TabsList className="grid w-full grid-cols-2 sm:w-96">
          <TabsTrigger value="matrix" className="gap-1.5 text-xs">
            <ShieldCheck className="h-3.5 w-3.5" />
            רמות הרשאה
          </TabsTrigger>
          <TabsTrigger value="super" className="gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" />
            סופר אדמין
          </TabsTrigger>
        </TabsList>

        {/* ── The matrix ── */}
        <TabsContent value="matrix" className="space-y-5">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>מה כל רמת הרשאה יכולה לעשות</CardTitle>
              <CardDescription>
                בחר רמה, ואז פתח או חסום כל יכולת בנפרד. הרשאה שלא נגעת בה נשארת על
                ״ברירת מחדל״ וממשיכה להתנהג בדיוק כמו היום — כך שהמסך הזה לא משנה כלום
                עד שמחליטים לשנות. חסימת סעיף אב חוסמת אוטומטית את כל מה שמתחתיו.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {EDITABLE_ACCESS_LEVELS.map((lvl) => {
                  const meta = ACCESS_LEVEL_META[lvl];
                  const active = lvl === level;
                  const configured = countExplicit(working[lvl]);
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setLevel(lvl)}
                      aria-pressed={active}
                      className={`rounded-xl border p-4 text-right transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        active
                          ? 'border-primary bg-primary/5 shadow-card'
                          : 'border-border bg-card hover:border-primary/50'
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl ${
                          active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                        }`}
                        style={{ fontSize: '22px' }}
                        aria-hidden="true"
                      >
                        {meta.icon}
                      </span>
                      <p className="font-semibold text-foreground">{meta.label}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {meta.description}
                      </p>
                      <p className="mt-2 text-[11px] text-muted-foreground/80">
                        {configured === 0 ? 'הכול על ברירת מחדל' : `${configured} הרשאות הוגדרו ידנית`}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 px-4 py-3">
                <p className="flex-1 text-sm">
                  עורך כעת:{' '}
                  <span className="font-semibold">{ACCESS_LEVEL_META[level].label}</span>
                  {explicitCount > 0 ? (
                    <Badge variant="secondary" className="ms-2 h-5 px-1.5 text-[10px] font-normal">
                      {explicitCount} שינויים מברירת המחדל
                    </Badge>
                  ) : null}
                </p>
                {dirty ? (
                  <>
                    <Button variant="ghost" onClick={() => setDraft(null)} disabled={saveMutation.isPending}>
                      ביטול
                    </Button>
                    <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
                      {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      שמירה
                    </Button>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">אין שינויים לשמירה</span>
                )}
              </div>

              <PermissionTree
                groups={PERMISSION_GROUPS}
                getState={getState}
                onToggle={onToggle}
                onReset={onReset}
                onSetGroup={onSetGroup}
              />

              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border/60 pt-4">
                {dirty ? (
                  <>
                    <Button variant="ghost" onClick={() => setDraft(null)} disabled={saveMutation.isPending}>
                      ביטול
                    </Button>
                    <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
                      {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      שמירה
                    </Button>
                  </>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Super admins ── */}
        <TabsContent value="super">
          <SuperAdminPanel
            canEdit={isSuperAdmin || !superAdminExists}
            isMember={isSuperAdmin}
            currentEmail={effectiveUser?.email}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}


/**
 * Appointing and removing super admins.
 *
 * The membership itself is confidential: `public.super_admins` returns rows
 * only to members, so this panel is the one place in the app that can name
 * them, and it only ever renders for somebody who is already one (or during
 * the bootstrap window, when the set is provably empty and there is nothing to
 * disclose).
 *
 * `candidates` deliberately does NOT try to mark which of the listed admins
 * are already super admins — for a non-member that information is unavailable,
 * and building the list as "everyone minus the members" would have leaked it
 * by omission.
 */
function SuperAdminPanel({ canEdit, isMember, currentEmail }) {
  const queryClient = useQueryClient();

  // Members only. For anyone else this resolves to an empty list, which is
  // indistinguishable from "nobody has been appointed".
  const { data: memberIds = [], isLoading: loadingMembers, error: membersError } = useQuery({
    queryKey: SUPER_ADMIN_MEMBERS_QUERY_KEY,
    staleTime: 60_000,
    retry: 1,
    queryFn: async () => {
      const rows = await base44.entities.SuperAdmin.list();
      return (Array.isArray(rows) ? rows : []).map((r) => r.user_id);
    },
  });

  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: REPS_QUERY_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const rows = await base44.entities.User.list();
      return Array.isArray(rows) ? rows : [];
    },
  });

  const mutation = useMutation({
    mutationFn: async ({ user, makeSuper }) => {
      if (makeSuper) {
        return base44.entities.SuperAdmin.create({
          user_id: user.id,
          created_by: currentEmail || '',
        });
      }
      return base44.entities.SuperAdmin.delete(user.id);
    },
    onSuccess: (_r, vars) => {
      queryClient.invalidateQueries({ queryKey: SUPER_ADMIN_MEMBERS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: SUPER_ADMIN_EXISTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: SUPER_ADMIN_QUERY_KEY });
      toast.success(vars.makeSuper ? 'הוגדר כסופר אדמין' : 'הוסרה רמת סופר אדמין');
    },
    onError: (err) => toast.error(describeWriteFailure(err)),
  });

  const isLoading = loadingMembers || loadingUsers;
  const memberSet = new Set(memberIds);
  const supers = users.filter((u) => memberSet.has(u.id));
  const candidates = users.filter(
    (u) => u.role === 'admin' && !memberSet.has(u.id) && u.is_active !== false,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>סופר אדמין</CardTitle>
        <CardDescription>
          הרמה שמחזיקה את מערכת ההרשאות עצמה — עריכת המטריצה, חריגים לנציג בודד ומינוי
          סופר אדמין נוסף. מי נמצא ברשימה הזו גלוי אך ורק לסופר אדמין: הרשימה שמורה
          בטבלה נפרדת שרק חברים בה רשאים לקרוא, כך שגם פנייה ישירה ל-API לא תחשוף אותה.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {membersError && !isMissingSchemaError(membersError) ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            לא ניתן לטעון את רשימת הסופר אדמינים.
          </p>
        ) : null}

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-sm font-medium">סופר אדמינים פעילים</p>
              {supers.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  {isMember ? 'עדיין לא הוגדר אף סופר אדמין.' : 'הרשימה גלויה לסופר אדמין בלבד.'}
                </p>
              ) : (
                supers.map((user) => (
                  <div key={user.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <UserAvatar user={user} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{user.full_name || user.email}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </div>
                    <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100">סופר אדמין</Badge>
                    {canEdit && user.email !== currentEmail ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-red-600 hover:bg-red-50"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate({ user, makeSuper: false })}
                      >
                        הסר
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
              {supers.some((u) => u.email === currentEmail) ? (
                <p className="text-[11px] text-muted-foreground">
                  אי אפשר להסיר את רמת סופר אדמין מעצמך — כך אף אחד לא נועל את עצמו בטעות מחוץ למסך.
                </p>
              ) : null}
            </div>

            {canEdit ? (
              <div className="space-y-2 border-t border-border/60 pt-4">
                <p className="text-sm font-medium">מינוי סופר אדמין</p>
                {candidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">אין מנהלים נוספים למינוי.</p>
                ) : (
                  candidates.map((user) => (
                    <div key={user.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                      <UserAvatar user={user} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{user.full_name || user.email}</p>
                        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate({ user, makeSuper: true })}
                      >
                        הגדר כסופר אדמין
                      </Button>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <p className="border-t border-border/60 pt-4 text-sm text-muted-foreground">
                רק סופר אדמין רשאי למנות סופר אדמין נוסף.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
