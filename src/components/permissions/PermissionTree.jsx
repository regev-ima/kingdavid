import React, { useMemo, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, RotateCcw, Search, Lock } from 'lucide-react';
import { PERMISSION_GROUPS, getDescendantKeys } from '@/lib/permissions';

/**
 * The permission tree, shared by the role matrix and the per-rep exceptions
 * screen. Both ask the same question of every node — "open or blocked, and who
 * decided that?" — so both render through here.
 *
 * The caller owns the state and answers three things per key:
 *   getState(key)  → { allowed, explicit, source, blockedBy }
 *   onToggle(key, next)
 *   onReset(key)   → drop the explicit value, fall back to the default
 *
 * `explicit` is the distinction the whole design rests on: a switch that is on
 * because nobody ever touched it is not the same as one somebody deliberately
 * turned on. Only the second kind is written to the database, so the ones that
 * were never touched keep tracking the legacy behaviour as it changes.
 */

function matchesSearch(node, term) {
  if (!term) return true;
  const haystack = `${node.label} ${node.description || ''} ${node.key}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function PermissionRow({ node, depth, state, onToggle, onReset, readOnly, disabledReason }) {
  const blocked = state.blockedBy != null;
  const locked = readOnly || blocked;

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
        blocked ? 'border-dashed border-border/60 bg-muted/30' : 'border-border bg-card'
      }`}
      style={{ marginInlineStart: depth * 18 }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-sm font-medium ${blocked ? 'text-muted-foreground' : 'text-foreground'}`}>
            {node.label}
          </p>
          {state.explicit ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
              הוגדר ידנית
            </Badge>
          ) : (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground">
              ברירת מחדל
            </Badge>
          )}
          {blocked ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
              <Lock className="h-3 w-3" />
              חסום כי סעיף האב חסום
            </span>
          ) : null}
        </div>
        {node.description ? (
          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{node.description}</p>
        ) : null}
        {!blocked && state.sourceLabel ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground/80">{state.sourceLabel}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
        {state.explicit && !readOnly ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => onReset(node.key)}
            title="חזרה לברירת המחדל"
            aria-label={`חזרה לברירת המחדל עבור ${node.label}`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        <Switch
          checked={state.allowed}
          disabled={locked}
          onCheckedChange={(value) => onToggle(node.key, value)}
          aria-label={node.label}
          title={blocked ? 'סעיף האב חסום' : disabledReason || undefined}
        />
      </div>
    </div>
  );
}

function renderNodes(nodes, depth, ctx) {
  const out = [];
  for (const node of nodes) {
    const selfMatches = matchesSearch(node, ctx.search);
    const children = node.children || [];
    const renderedChildren = renderNodes(children, depth + 1, ctx);
    // A node stays visible when it matches OR when one of its descendants
    // does — otherwise a search hit deep in the tree would appear with no
    // parent, and the reader would have no idea what it hangs off.
    if (!selfMatches && renderedChildren.length === 0) continue;

    out.push(
      <PermissionRow
        key={node.key}
        node={node}
        depth={depth}
        state={ctx.getState(node.key)}
        onToggle={ctx.onToggle}
        onReset={ctx.onReset}
        readOnly={ctx.readOnly?.(node.key)}
        disabledReason={ctx.disabledReason?.(node.key)}
      />,
    );
    out.push(...renderedChildren);
  }
  return out;
}

export default function PermissionTree({
  getState,
  onToggle,
  onReset,
  onSetGroup,
  readOnly,
  disabledReason,
  groups = PERMISSION_GROUPS,
  emptyHint = 'לא נמצאה הרשאה מתאימה.',
}) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());

  const toggleGroup = (key) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const ctx = { getState, onToggle, onReset, readOnly, disabledReason, search };

  const rendered = useMemo(
    () =>
      groups.map((group) => ({
        group,
        rows: renderNodes(group.permissions, 0, ctx),
      })),
    // Deps are ctx's contents rather than ctx itself: the object is rebuilt on
    // every render, so depending on it would defeat the memo entirely.
    [groups, search, getState, onToggle, onReset, readOnly, disabledReason],
  );

  const visible = rendered.filter((entry) => entry.rows.length > 0);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute inset-y-0 end-3 my-auto h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש הרשאה — למשל: כספים, מחיקה, ייצוא"
          className="pe-9"
        />
      </div>

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{emptyHint}</p>
      ) : null}

      {visible.map(({ group, rows }) => {
        const isCollapsed = collapsed.has(group.key) && !search;
        return (
          <div key={group.key} className="rounded-xl border border-border bg-card/50">
            <div className="flex items-start gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                className="flex min-w-0 flex-1 items-start gap-3 text-right"
                aria-expanded={!isCollapsed}
              >
                <span
                  className="material-symbols-outlined mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                  style={{ fontSize: '20px' }}
                  aria-hidden="true"
                >
                  {group.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-foreground">{group.label}</span>
                  <span className="block text-xs text-muted-foreground">{group.description}</span>
                </span>
                <ChevronDown
                  className={`mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                    isCollapsed ? '-rotate-90' : ''
                  }`}
                />
              </button>
              {onSetGroup && !isCollapsed ? (
                <div className="flex shrink-0 items-center gap-1 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => onSetGroup(group, true)}
                  >
                    פתח הכל
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => onSetGroup(group, false)}
                  >
                    חסום הכל
                  </Button>
                </div>
              ) : null}
            </div>
            {isCollapsed ? null : <div className="space-y-1.5 px-4 pb-4">{rows}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** Every key in a group, parents and children alike — for "פתח הכל". */
export function groupKeys(group) {
  const out = [];
  for (const node of group.permissions) {
    out.push(node.key, ...getDescendantKeys(node.key));
  }
  return out;
}
