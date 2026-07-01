import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2, Radio, Check, Search } from 'lucide-react';
import { useLeadSourceIcons, normalizeSourceKey } from '@/hooks/useLeadSourceIcons';
import {
  SourceIconGlyph,
  SELECTABLE_SOURCE_ICONS,
  matchSourceIconId,
  SOURCE_ICON_MAP,
  DEFAULT_SOURCE_ICON_ID,
} from '@/constants/leadSourceIcons';
import { LEAD_SOURCE_OPTIONS, SOURCE_LABELS } from '@/constants/leadOptions';

// Admin screen: assign an icon to every lead-arrival source. Sources are
// discovered automatically from the leads themselves (a light source-only
// query), so a brand-new source joins this list on its own. For each source
// the admin can pick any icon from the library or leave it on "אוטומטי"
// (auto-matched from the source text, with a neutral default fallback).
export default function LeadSourcesTab() {
  const { overrides, setSourceIcon, removeSourceIcon } = useLeadSourceIcons();
  const [search, setSearch] = useState('');

  // Distinct sources from recent leads (source column only → tiny payload).
  const { data: leadSources = [], isLoading } = useQuery({
    queryKey: ['lead-source-list'],
    // columns is a PostgREST select STRING (not an array) — fetch just the
    // source column of recent leads so distinct sources are cheap to derive.
    queryFn: () => base44.entities.Lead.filter({}, '-effective_sort_date', 5000, undefined, 'source'),
    staleTime: 300000,
  });

  // Union of: sources seen in leads, the app's predefined options, and any
  // source that already has an override — deduped by normalized key.
  const sources = useMemo(() => {
    const byKey = new Map();
    for (const lead of leadSources) {
      const raw = String(lead?.source ?? '').trim();
      if (raw) byKey.set(normalizeSourceKey(raw), raw);
    }
    for (const opt of LEAD_SOURCE_OPTIONS) {
      const key = normalizeSourceKey(opt.value);
      if (!byKey.has(key)) byKey.set(key, opt.value);
    }
    for (const key of Object.keys(overrides)) {
      if (!byKey.has(key)) byKey.set(key, key);
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'he'));
  }, [leadSources, overrides]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter((s) => {
      const label = SOURCE_LABELS[s] || s;
      return s.toLowerCase().includes(q) || label.toLowerCase().includes(q);
    });
  }, [sources, search]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radio className="h-5 w-5" />
          מקורות הגעה
        </CardTitle>
        <CardDescription>
          לכל מקור הגעה אפשר לבחור אייקון שיוצג בטבלת הלידים ובכרטיס הליד במקום הטקסט,
          כדי לזהות במבט אחד מאיפה הגיע הליד. מקור חדש מצטרף לרשימה אוטומטית. מקורות
          מוכרים (פייסבוק, גוגל, טיקטוק וכו׳) מזוהים לבד; אפשר לשנות ידנית. ללא בחירה —
          מוצג אייקון ברירת מחדל. ההגדרה נשמרת בדפדפן הזה.
        </CardDescription>
      </CardHeader>
      <CardContent dir="rtl" className="space-y-4">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חפש מקור הגעה…"
            className="ps-3 pe-9 h-9"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">לא נמצאו מקורות הגעה.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((source) => {
              const key = normalizeSourceKey(source);
              const overrideId = overrides[key];
              const resolvedId = overrideId || matchSourceIconId(source);
              const isAuto = !overrideId;
              const label = SOURCE_LABELS[source] || source;
              const autoMatchId = matchSourceIconId(source);
              const autoIsDefault = autoMatchId === DEFAULT_SOURCE_ICON_ID;

              return (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted/60 shrink-0">
                      <SourceIconGlyph iconId={resolvedId} className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{label}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {isAuto ? (autoIsDefault ? 'ברירת מחדל' : `זוהה אוטומטית · ${SOURCE_ICON_MAP[resolvedId]?.label}`) : `מותאם · ${SOURCE_ICON_MAP[resolvedId]?.label}`}
                      </p>
                    </div>
                  </div>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="shrink-0 h-8 text-xs">
                        שנה אייקון
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" dir="rtl" className="w-64 p-2">
                      <button
                        type="button"
                        onClick={() => removeSourceIcon(source)}
                        className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors ${isAuto ? 'bg-muted/70' : ''}`}
                      >
                        <span className="inline-flex h-6 w-6 items-center justify-center">
                          <SourceIconGlyph iconId={autoMatchId} className="h-4 w-4" />
                        </span>
                        <span className="flex-1 text-right">אוטומטי / ברירת מחדל</span>
                        {isAuto && <Check className="h-4 w-4 text-primary" />}
                      </button>
                      <div className="my-1 h-px bg-border" />
                      <div className="grid grid-cols-4 gap-1">
                        {SELECTABLE_SOURCE_ICONS.map((icon) => {
                          const selected = overrideId === icon.id;
                          return (
                            <button
                              key={icon.id}
                              type="button"
                              title={icon.label}
                              onClick={() => setSourceIcon(source, icon.id)}
                              className={`flex flex-col items-center gap-1 rounded-md px-1 py-2 hover:bg-muted transition-colors ${selected ? 'bg-primary/10 ring-1 ring-primary/40' : ''}`}
                            >
                              <SourceIconGlyph iconId={icon.id} className="h-5 w-5" />
                              <span className="text-[9px] text-muted-foreground leading-none truncate w-full text-center">{icon.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
