import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, Save, CalendarDays, CalendarX2, PartyPopper, Plus, Trash2,
  ChevronDown, Lock, Clock, DoorOpen,
} from 'lucide-react';
import { format } from '@/lib/safe-date-fns';
import { he } from 'date-fns/locale';
import { useCompanyClosures } from '@/hooks/useCompanyClosures';
import { useIsraeliHolidays } from '@/hooks/useIsraeliHolidays';
import { WEEKDAY_LABELS, DEFAULT_CLOSURES, holidayDefaultStatus } from '@/lib/companyClosures';

const STATUS_META = {
  closed: { label: 'סגור', icon: Lock, on: 'bg-red-100 text-red-700 border-red-300', dot: 'bg-red-500' },
  half_day: { label: 'חצי יום', icon: Clock, on: 'bg-amber-100 text-amber-700 border-amber-300', dot: 'bg-amber-500' },
  open: { label: 'פתוח', icon: DoorOpen, on: 'bg-emerald-100 text-emerald-700 border-emerald-300', dot: 'bg-emerald-500' },
};

function statusEquals(a, b) {
  if (!a || !b) return false;
  if (a.status !== b.status) return false;
  if (a.status === 'half_day') return (a.until || '') === (b.until || '');
  return true;
}

// 3-way segmented control (סגור / חצי יום / פתוח) + an inline time input that
// shows only for "חצי יום".
function StatusSegments({ value, onChange, defaultUntil }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {['closed', 'half_day', 'open'].map((s) => {
        const meta = STATUS_META[s];
        const Icon = meta.icon;
        const active = value.status === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s === 'half_day'
              ? { status: 'half_day', until: value.until || defaultUntil || '13:00' }
              : { status: s })}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all ${
              active ? meta.on : 'bg-white border-border text-muted-foreground hover:bg-muted/50'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {meta.label}
          </button>
        );
      })}
      {value.status === 'half_day' && (
        <Input
          type="time"
          value={value.until || defaultUntil || '13:00'}
          onChange={(e) => onChange({ status: 'half_day', until: e.target.value })}
          className="h-8 w-[110px] text-xs"
          aria-label="פתוח עד"
        />
      )}
    </div>
  );
}

export default function CompanyClosuresTab() {
  const queryClient = useQueryClient();
  const { raw, isError, isLoading } = useCompanyClosures();

  const [draft, setDraft] = useState({ ...DEFAULT_CLOSURES });

  useEffect(() => {
    if (raw) {
      setDraft({
        weekly_closed_days: Array.isArray(raw.weekly_closed_days) ? raw.weekly_closed_days.map(Number) : [...DEFAULT_CLOSURES.weekly_closed_days],
        close_on_holidays: raw.close_on_holidays !== false,
        erev_half_day: raw.erev_half_day !== false,
        erev_until: raw.erev_until || DEFAULT_CLOSURES.erev_until,
        holiday_overrides: raw.holiday_overrides && typeof raw.holiday_overrides === 'object' && !Array.isArray(raw.holiday_overrides) ? raw.holiday_overrides : {},
        custom_closures: Array.isArray(raw.custom_closures) ? raw.custom_closures : [],
      });
    }
  }, [raw]);

  // 10 years of holidays for the override list.
  const rangeStart = useMemo(() => new Date(), []);
  const rangeEnd = useMemo(() => { const d = new Date(); d.setFullYear(d.getFullYear() + 10); return d; }, []);
  const holidaysByDate = useIsraeliHolidays(rangeStart, rangeEnd);

  // Build a flat, sorted list of upcoming holidays grouped by Gregorian year.
  const holidaysByYear = useMemo(() => {
    const todayKey = format(new Date(), 'yyyy-MM-dd');
    const rows = Object.entries(holidaysByDate)
      .filter(([key]) => key >= todayKey)
      .map(([key, items]) => {
        const primary = items.find((i) => i.isYomTov) || items.find((i) => i.isErev) || items[0];
        return { key, items, name: primary?.hebrew || primary?.title || '', primary };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
    const grouped = {};
    for (const row of rows) {
      const year = row.key.slice(0, 4);
      (grouped[year] = grouped[year] || []).push(row);
    }
    return grouped;
  }, [holidaysByDate]);

  const years = Object.keys(holidaysByYear).sort();
  const [openYears, setOpenYears] = useState(() => new Set());
  useEffect(() => {
    // Default-open the nearest year once holidays load.
    if (years.length && openYears.size === 0) setOpenYears(new Set([years[0]]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years.length]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.CompanyClosures.update(1, {
        weekly_closed_days: draft.weekly_closed_days,
        close_on_holidays: draft.close_on_holidays,
        erev_half_day: draft.erev_half_day,
        erev_until: draft.erev_until,
        holiday_overrides: draft.holiday_overrides,
        custom_closures: draft.custom_closures,
      });
    },
    onSuccess: () => {
      toast.success('הגדרות ימי הסגירה נשמרו');
      queryClient.invalidateQueries({ queryKey: ['company-closures'] });
    },
    onError: (err) => toast.error(`שמירה נכשלה: ${err?.message || 'שגיאה'}`),
  });

  const toggleWeekday = (idx) => {
    setDraft((d) => ({
      ...d,
      weekly_closed_days: d.weekly_closed_days.includes(idx)
        ? d.weekly_closed_days.filter((x) => x !== idx)
        : [...d.weekly_closed_days, idx].sort((a, b) => a - b),
    }));
  };

  const setHolidayOverride = (key, defStatus, next) => {
    setDraft((d) => {
      const overrides = { ...d.holiday_overrides };
      if (statusEquals(next, { status: defStatus.status, until: defStatus.until })) {
        delete overrides[key]; // back to default → don't persist a redundant override
      } else {
        overrides[key] = next;
      }
      return { ...d, holiday_overrides: overrides };
    });
  };

  // ---- Custom closures add form ----
  const [customDate, setCustomDate] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [customType, setCustomType] = useState('closed');
  const [customUntil, setCustomUntil] = useState('13:00');
  const todayKey = format(new Date(), 'yyyy-MM-dd');

  const addCustomClosure = () => {
    const date = customDate;
    const reason = customReason.trim();
    if (!date || !reason) return;
    if (draft.custom_closures.some((c) => c.date === date)) {
      toast.error('כבר קיים יום סגירה בתאריך הזה');
      return;
    }
    const entry = customType === 'half_day'
      ? { date, reason, type: 'half_day', until: customUntil }
      : { date, reason, type: 'closed' };
    setDraft((d) => ({ ...d, custom_closures: [...d.custom_closures, entry].sort((a, b) => a.date.localeCompare(b.date)) }));
    setCustomDate(''); setCustomReason(''); setCustomType('closed'); setCustomUntil('13:00');
  };

  const removeCustomClosure = (date) => {
    setDraft((d) => ({ ...d, custom_closures: d.custom_closures.filter((c) => c.date !== date) }));
  };

  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (isError) {
    return (
      <Card>
        <CardHeader><CardTitle>ימי סגירה וחגים</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            לא ניתן לטעון את הגדרות ימי הסגירה מהשרת. ייתכן שה-migration של company_closures עדיין לא הופעל. נסה שוב בעוד כמה דקות.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Weekly closed days */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarX2 className="h-5 w-5" /> ימי סגירה קבועים בשבוע</CardTitle>
          <CardDescription>הימים שבהם המשרד סגור באופן קבוע. נציגים לא יוכלו לקבוע משימה ביום סגור.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
            {WEEKDAY_LABELS.map((label, idx) => {
              const closed = draft.weekly_closed_days.includes(idx);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleWeekday(idx)}
                  className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 text-sm font-bold transition-all ${
                    closed ? 'border-red-400 bg-red-50 text-red-700' : 'border-border bg-white text-muted-foreground hover:border-border/80'
                  }`}
                >
                  <span>{label}</span>
                  <span className="text-[10px] font-normal opacity-70">{closed ? 'סגור' : 'פתוח'}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Holidays */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PartyPopper className="h-5 w-5" /> חגים וערבי חג</CardTitle>
          <CardDescription>ברירות-המחדל חלות על כל החגים. ניתן לעקוף חג מסוים ברשימה למטה (10 שנים קדימה).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <p className="font-semibold text-sm">סגור בחגים (ימים טובים)</p>
              <p className="text-xs text-muted-foreground">פסח, שבועות, ראש השנה, יום כיפור, סוכות וכו'</p>
            </div>
            <Switch checked={draft.close_on_holidays} onCheckedChange={(v) => setDraft((d) => ({ ...d, close_on_holidays: v }))} />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <p className="font-semibold text-sm">ערב חג — חצי יום</p>
              <p className="text-xs text-muted-foreground">פתוחים בערב חג עד השעה שנבחרה</p>
            </div>
            <div className="flex items-center gap-2">
              {draft.erev_half_day && (
                <Input
                  type="time"
                  value={draft.erev_until}
                  onChange={(e) => setDraft((d) => ({ ...d, erev_until: e.target.value }))}
                  className="h-8 w-[110px] text-xs"
                  aria-label="ערב חג פתוח עד"
                />
              )}
              <Switch checked={draft.erev_half_day} onCheckedChange={(v) => setDraft((d) => ({ ...d, erev_half_day: v }))} />
            </div>
          </div>

          <Separator />

          {/* Per-holiday overrides, grouped by year */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              לוח החגים (לפי Hebcal). כל חג מציג את ברירת-המחדל; שנו רק חגים ספציפיים לפי הצורך.
            </p>
            {years.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" /> טוען חגים…
              </div>
            )}
            {years.map((year) => {
              const isOpen = openYears.has(year);
              const rows = holidaysByYear[year];
              return (
                <div key={year} className="border rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenYears((prev) => {
                      const next = new Set(prev);
                      next.has(year) ? next.delete(year) : next.add(year);
                      return next;
                    })}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors"
                  >
                    <span className="flex items-center gap-2 font-semibold text-sm">
                      <CalendarDays className="h-4 w-4 text-muted-foreground" />
                      {year} <span className="text-xs font-normal text-muted-foreground">({rows.length} חגים)</span>
                    </span>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="divide-y">
                      {rows.map((row) => {
                        const def = holidayDefaultStatus(row.items, draft);
                        const defStatus = { status: def.status, until: def.until };
                        const override = draft.holiday_overrides[row.key];
                        const current = override || defStatus;
                        const dateObj = new Date(`${row.key}T00:00:00`);
                        const isOverridden = !!override;
                        return (
                          <div key={row.key} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3">
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{row.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {format(dateObj, 'EEEE, d בMMMM', { locale: he })}
                                {isOverridden && <span className="ms-2 text-primary">• הוגדר ידנית</span>}
                              </p>
                            </div>
                            <StatusSegments
                              value={current}
                              defaultUntil={draft.erev_until}
                              onChange={(next) => setHolidayOverride(row.key, defStatus, next)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Custom closures */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarX2 className="h-5 w-5" /> ימי סגירה מיוחדים</CardTitle>
          <CardDescription>הוסיפו תאריכים נקודתיים שבהם המשרד סגור (למשל יום כיף חברה). חובה לציין סיבה.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr_auto] gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">תאריך</Label>
              <Input type="date" min={todayKey} value={customDate} onChange={(e) => setCustomDate(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">סיבה (חובה)</Label>
              <Input
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="למשל: יום כיף חברה"
                className="h-9"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomClosure(); } }}
              />
            </div>
            <Button type="button" onClick={addCustomClosure} disabled={!customDate || !customReason.trim()} className="h-9">
              <Plus className="h-4 w-4 me-1" /> הוסף
            </Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">סוג סגירה:</span>
            {[{ v: 'closed', l: 'יום מלא' }, { v: 'half_day', l: 'חצי יום' }].map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setCustomType(opt.v)}
                className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all ${
                  customType === opt.v ? 'bg-primary/10 border-primary text-primary' : 'bg-white border-border text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {opt.l}
              </button>
            ))}
            {customType === 'half_day' && (
              <Input type="time" value={customUntil} onChange={(e) => setCustomUntil(e.target.value)} className="h-8 w-[110px] text-xs" aria-label="פתוח עד" />
            )}
          </div>

          {draft.custom_closures.length > 0 ? (
            <div className="space-y-1.5">
              {draft.custom_closures.map((c) => {
                const meta = STATUS_META[c.type === 'half_day' ? 'half_day' : 'closed'];
                return (
                  <div key={c.date} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`h-2 w-2 rounded-full ${meta.dot} flex-shrink-0`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{c.reason}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(`${c.date}T00:00:00`), 'EEEE, d בMMMM yyyy', { locale: he })}
                          {' · '}{c.type === 'half_day' ? `חצי יום עד ${c.until}` : 'יום מלא'}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removeCustomClosure(c.date)} className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" aria-label="מחק">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">לא הוגדרו ימי סגירה מיוחדים.</p>
          )}
        </CardContent>
      </Card>

      {/* Save bar */}
      <div className="flex items-center gap-3 sticky bottom-0 bg-background/80 backdrop-blur py-3">
        <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Save className="h-4 w-4 me-2" />}
          שמור הגדרות
        </Button>
        {raw?.updated_date && (
          <span className="text-xs text-muted-foreground">עודכן לאחרונה: {new Date(raw.updated_date).toLocaleString('he-IL')}</span>
        )}
      </div>
    </div>
  );
}
