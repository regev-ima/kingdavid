import React, { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, Save, ShieldCheck } from 'lucide-react';
import PermissionTree from '@/components/permissions/PermissionTree';
import { usePermissions } from '@/hooks/usePermissions';
import {
  ACCESS_LEVEL_META,
  EDITABLE_ACCESS_LEVELS,
  SOURCE,
  SOURCE_LABELS,
  canDelegatePermission,
  canGrantAccessLevel,
  explain as explainFor,
  getAccessLevel,
  normalizeOverrides,
} from '@/lib/permissions';
import { USER_SCOPES, getUserScope } from '@/lib/userScope';
import { GRANTABLE_PERMISSIONS } from '@/lib/rbac';

const SCOPE_LABELS = {
  [USER_SCOPES.ADMIN]: 'מנהל — גישה מלאה',
  [USER_SCOPES.SALES]: 'נציג מכירות — לידים, הצעות והזמנות שלו',
  [USER_SCOPES.FACTORY]: 'נציג מפעל — אזור המפעל והייצור',
  [USER_SCOPES.BOOKKEEPER]: 'מנהלת חשבונות — אזור חשבוניות ופיננסים',
};

/**
 * The "הרשאות" tab of a rep's card.
 *
 * Three layers, in the order they were added to the product, all still live:
 *
 *   1. the existing grantable switches (users.extra_permissions) — untouched,
 *      because reps are relying on them right now,
 *   2. the access level (users.access_level) — which tier's defaults apply,
 *   3. per-rep exceptions (users.permission_overrides) — open or block a
 *      single capability for this one person, whatever the level says.
 *
 * All three save together, so the tab is one decision rather than three.
 */
export default function RepPermissionsTab({ rep, role, onSave, saving }) {
  const { effectiveUser: actor, matrix, canManageUserPermissions } = usePermissions();

  const [permissions, setPermissions] = useState(() => rep?.extra_permissions || {});
  const [accessLevel, setAccessLevel] = useState(() => getAccessLevel(rep));
  const [overrides, setOverrides] = useState(() => normalizeOverrides(rep?.permission_overrides));

  const isTargetAdmin = role === 'admin';

  // The rep as they WOULD be once saved, so the tree previews the pending
  // choices rather than what is currently in the database.
  const previewUser = useMemo(
    () => ({
      ...rep,
      role,
      access_level: accessLevel,
      extra_permissions: permissions,
      permission_overrides: overrides,
    }),
    [rep, role, accessLevel, permissions, overrides],
  );

  const getState = useCallback(
    (key) => {
      const resolved = explainFor(previewUser, key, { matrix });
      const explicit = typeof overrides[key] === 'boolean';
      return {
        allowed: resolved.allowed,
        explicit,
        blockedBy: resolved.blockedBy,
        sourceLabel: explicit ? null : SOURCE_LABELS[resolved.source],
      };
    },
    [previewUser, matrix, overrides],
  );

  const onToggle = useCallback(
    (key, value) => setOverrides((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const onReset = useCallback(
    (key) =>
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      }),
    [],
  );

  // An admin can only hand out what they hold themselves — otherwise a manager
  // who was deliberately denied כספים could open it for a rep and then use
  // "התחזות" to look through their eyes.
  const readOnly = useCallback(
    (key) => !canDelegatePermission(actor, key),
    [actor],
  );

  const disabledReason = useCallback(
    (key) => (canDelegatePermission(actor, key) ? undefined : 'אי אפשר להעניק הרשאה שאין לך בעצמך'),
    [actor],
  );

  // Only the three storable levels. סופר אדמין is not a value of this column
  // and is not appointed from here — putting it in the picker would announce
  // the tier to every manager who opens a rep's card.
  const grantableLevels = EDITABLE_ACCESS_LEVELS.filter(
    (lvl) => lvl === accessLevel || canGrantAccessLevel(actor, lvl),
  );

  const handleSave = () =>
    onSave(
      {
        extra_permissions: permissions,
        access_level: accessLevel,
        permission_overrides: overrides,
      },
      'ההרשאות נשמרו',
    );

  const overrideCount = Object.keys(overrides).length;
  const scopeLabel = SCOPE_LABELS[getUserScope({ ...rep, role })] || '';

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-muted/40 p-3 text-sm">
        <p className="font-medium">הרשאות לפי תפקיד</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{scopeLabel}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          כל מה שמופיע כאן מתווסף מעל מה שהתפקיד כבר מאפשר. הרשאה שלא נגעת בה ממשיכה
          להתנהג בדיוק כמו היום.
        </p>
      </div>

      {/* ── 1. Access level ── */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">רמת הרשאה</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          קובעת את ברירות המחדל של הנציג. חריגים אישיים בהמשך העמוד גוברים עליה.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {EDITABLE_ACCESS_LEVELS.map((lvl) => {
            const meta = ACCESS_LEVEL_META[lvl];
            const active = accessLevel === lvl;
            const allowed = grantableLevels.includes(lvl);
            return (
              <button
                key={lvl}
                type="button"
                disabled={!allowed || !canManageUserPermissions}
                onClick={() => setAccessLevel(lvl)}
                aria-pressed={active}
                className={`rounded-lg border p-3 text-right transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                  active ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="material-symbols-outlined text-primary"
                    style={{ fontSize: '18px' }}
                    aria-hidden="true"
                  >
                    {meta.icon}
                  </span>
                  <p className="text-sm font-medium">{meta.label}</p>
                  {!allowed ? (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
                      מעל הרמה שלך
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {meta.description}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <Separator />

      {/* ── 2. The original grantable switches — kept exactly as they were ── */}
      <section className="space-y-2">
        <h4 className="text-sm font-semibold">הרשאות מיוחדות</h4>
        <p className="text-xs text-muted-foreground">
          ההרשאות שהיו כאן עד היום. הן ממשיכות לעבוד בדיוק כמו קודם, ורמת הרשאה שמכבה
          יכולת כזו לא מבטלת אותן — רק חריג אישי מפורש יכול.
        </p>
        <div className="space-y-2">
          {GRANTABLE_PERMISSIONS.map((p) => {
            const checked = isTargetAdmin ? true : permissions[p.key] === true;
            return (
              <div key={p.key} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground">{p.description}</p>
                </div>
                <Switch
                  checked={checked}
                  disabled={isTargetAdmin || !canManageUserPermissions}
                  onCheckedChange={(v) => setPermissions((prev) => ({ ...prev, [p.key]: v }))}
                />
              </div>
            );
          })}
        </div>
        {isTargetAdmin ? (
          <p className="text-[11px] text-muted-foreground">מנהל מקבל את כל ההרשאות באופן אוטומטי.</p>
        ) : null}
      </section>

      <Separator />

      {/* ── 3. Per-rep exceptions ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold">חריגים אישיים</h4>
          {overrideCount > 0 ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
              {overrideCount} חריגים
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          פתיחה או חסימה של יכולת ספציפית לנציג הזה בלבד, בלי לגעת בשאר הצוות. מתג
          שמסומן ״ברירת מחדל״ פשוט הולך לפי רמת ההרשאה והתפקיד.
        </p>
        {canManageUserPermissions ? (
          <PermissionTree
            getState={getState}
            onToggle={onToggle}
            onReset={onReset}
            readOnly={readOnly}
            disabledReason={disabledReason}
          />
        ) : (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            אין לך הרשאה לערוך חריגים אישיים.
          </p>
        )}
      </section>

      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
        <p className="text-[11px] text-muted-foreground">
          {SOURCE_LABELS[SOURCE.USER_OVERRIDE]} — נשמר על הנציג הזה בלבד.
        </p>
        <Button onClick={handleSave} disabled={saving || !canManageUserPermissions} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          שמור הרשאות
        </Button>
      </div>
    </div>
  );
}
