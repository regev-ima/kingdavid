import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, BedDouble, Loader2, SkipForward } from 'lucide-react';
import { getBedNoteType, BED_VAT_RATE, BED_FIELD_OTHER, FABRIC_CATALOG_FALLBACK_GROUP, FABRIC_CATALOG_FALLBACK_VALUES } from '@/lib/bedConfig';

const VAT = BED_VAT_RATE;
const withVat = (n) => Math.round((Number(n) || 0) * VAT);
const fmt = (n) => `₪${(Number(n) || 0).toLocaleString()}`;

// Guided bed configurator shown when a rep adds a bed to a quote. Steps through
// the option groups (ארגז מצעים → סוג ארגז → מסגרת → …) as single-choice
// questions with images, respecting dependencies and skippable steps, and a
// running total. On confirm it returns one priced line per chosen value — the
// exact same shape a "תוספות למוצר" click produces — so the host just splices
// them in under the bed line. Prices come from the linked add-on (single source
// of truth) or, for pure choices (בלי ארגז), the value's own flat price.
export default function BedConfigWizard({ open, onOpenChange, product, variation, token, initialLines = [], initialFields = [], onConfirm }) {
  const { data: rawGroups = [], isLoading: gL } = useQuery({
    queryKey: ['bed-option-groups'],
    queryFn: () => base44.entities.BedOptionGroup.list('sort_order'),
    enabled: open,
  });
  const { data: rawValues = [], isLoading: vL } = useQuery({
    queryKey: ['bed-option-values'],
    queryFn: () => base44.entities.BedOptionValue.list('sort_order'),
    enabled: open,
  });

  // Inject the client-side fabric catalog when the DB doesn't have it yet
  // (preview builds, before the seed migration merges). Never duplicates: once
  // the real DB group exists, the fallback is skipped.
  const hasFabricGroup = rawGroups.some((g) => g.key === 'fabric_catalog');
  const groups = useMemo(
    () => (hasFabricGroup ? rawGroups : [...rawGroups, FABRIC_CATALOG_FALLBACK_GROUP]),
    [rawGroups, hasFabricGroup],
  );
  const values = useMemo(
    () => (hasFabricGroup ? rawValues : [...rawValues, ...FABRIC_CATALOG_FALLBACK_VALUES]),
    [rawValues, hasFabricGroup],
  );
  // Same query keys as NewQuote/EditQuote → react-query dedupes, no extra fetch.
  const { data: addons = [] } = useQuery({
    queryKey: ['product-addons'],
    queryFn: () => base44.entities.ProductAddon.filter({ is_active: true }),
    enabled: open,
  });
  const { data: addonPrices = [] } = useQuery({
    queryKey: ['product-addon-prices'],
    queryFn: () => base44.entities.ProductAddonPrice.list(),
    enabled: open,
  });

  // answers: group.id -> selected value object | 'skip' | undefined (choice groups)
  const [answers, setAnswers] = useState({});
  // fieldValues: group.id -> { valueKey -> string } (text groups)
  const [fieldValues, setFieldValues] = useState({});
  // textGroupPrice: group.id -> string — optional extra charge (incl VAT) the rep
  // types for a text answer (e.g. a fabric that isn't free). Empty = no charge.
  const [textGroupPrice, setTextGroupPrice] = useState({});
  const [step, setStep] = useState(0);
  const seededRef = useRef(null);

  const valuesByGroup = useMemo(() => {
    const m = new Map();
    for (const v of values) {
      if (v.is_active === false) continue;
      if (!m.has(v.group_id)) m.set(v.group_id, []);
      m.get(v.group_id).push(v);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return m;
  }, [values]);

  const groupByKey = useMemo(() => new Map(groups.map((g) => [g.key, g])), [groups]);
  const addonById = useMemo(() => new Map(addons.map((a) => [a.id, a])), [addons]);

  // Prefill from previously-saved config lines (edit mode): rebuild the chosen
  // value per group from the persisted group/value keys.
  const initialAnswers = useMemo(() => {
    const map = {};
    for (const line of initialLines || []) {
      const g = groups.find((gg) => gg.key === line.bed_config_group_key);
      if (!g) continue;
      const v = (valuesByGroup.get(g.id) || []).find((vv) => vv.key === line.bed_config_value_key);
      if (v) map[g.id] = v;
    }
    return map;
  }, [initialLines, groups, valuesByGroup]);

  // Prefill text answers (edit mode) from the bed item's saved bed_config_fields.
  const initialFieldValues = useMemo(() => {
    const map = {};
    for (const grp of initialFields || []) {
      const g = groups.find((gg) => gg.key === grp.group_key);
      if (!g) continue;
      const byKey = {};
      for (const f of grp.values || []) byKey[f.key] = f.value ?? '';
      map[g.id] = byKey;
    }
    return map;
  }, [initialFields, groups]);

  // Prefill the optional text-answer charge (edit mode) from the saved priced
  // line we tagged with the '__text_charge__' sentinel. Stored incl-VAT.
  const initialTextPrices = useMemo(() => {
    const map = {};
    for (const line of initialLines || []) {
      if (line.bed_config_value_key !== '__text_charge__') continue;
      const g = groups.find((gg) => gg.key === line.bed_config_group_key);
      if (g) map[g.id] = String(Math.round((Number(line.total) || 0) * VAT));
    }
    return map;
  }, [initialLines, groups]);

  // Seed the answers once per open, after groups/values have loaded.
  const seedKey = open ? `${product?.id || ''}:${variation?.id || ''}:${token || ''}` : null;
  useEffect(() => {
    if (!open) { seededRef.current = null; return; }
    if (gL || vL) return; // wait for data
    if (seededRef.current === seedKey) return;
    setAnswers(initialAnswers);
    setFieldValues(initialFieldValues);
    setTextGroupPrice(initialTextPrices);
    setStep(0);
    seededRef.current = seedKey;
  }, [open, seedKey, gL, vL, initialAnswers, initialFieldValues, initialTextPrices]);

  // A choice's price: from the linked add-on (variation → product → size → base),
  // else the value's own flat price. Pre-VAT, like the add-on line.
  const priceOf = (value) => {
    if (value?.addon_id) {
      const addon = addonById.get(value.addon_id);
      if (addon) {
        const specific = addonPrices.find(
          (ap) => ap.addon_id === addon.id && ap.product_id === product?.id && ap.product_variation_id === variation?.id
        );
        const productP = addonPrices.find(
          (ap) => ap.addon_id === addon.id && ap.product_id === product?.id && !ap.product_variation_id
        );
        const sizeP = addon.size_prices?.find(
          (sp) => sp.width_cm === variation?.width_cm && sp.length_cm === variation?.length_cm
        );
        return specific?.price ?? productP?.price ?? sizeP?.price ?? addon.base_price ?? addon.price ?? 0;
      }
    }
    // Manual prices are entered incl-VAT (final price to the customer); the quote
    // line stores pre-VAT and re-adds VAT, so convert back here.
    return (Number(value?.price) || 0) / VAT;
  };

  // A group is shown only if it has no dependency, or the depended group's chosen
  // value matches the required key.
  const depSatisfied = (g) => {
    if (!g.depends_on_group_key) return true;
    const dep = groupByKey.get(g.depends_on_group_key);
    if (!dep) return true;
    const ans = answers[dep.id];
    return ans && ans !== 'skip' && ans.key === g.depends_on_value_key;
  };

  const visibleGroups = useMemo(
    () => groups.filter((g) => g.is_active !== false && depSatisfied(g)),
    [groups, answers, groupByKey]
  );

  // Keep the step pointer valid as dependencies add/remove groups.
  useEffect(() => {
    if (step > visibleGroups.length - 1) setStep(Math.max(0, visibleGroups.length - 1));
  }, [visibleGroups.length, step]);

  const current = visibleGroups[step];
  const isLast = step >= visibleGroups.length - 1;
  const isTextGroup = current?.input_type === 'text';
  const answered = current ? answers[current.id] : undefined;
  // Text groups are optional metadata — never block. Choice groups block only
  // when they're mandatory (not skippable) and still unanswered.
  const canProceed = !current || isTextGroup || current.skippable !== false || (answered && answered !== 'skip');

  // Non-empty text field values for a group, in field order.
  const textValuesOf = (g) => {
    const gv = fieldValues[g.id] || {};
    return (valuesByGroup.get(g.id) || [])
      .map((v) => ({ key: v.key, label: v.label, value: String(gv[v.key] ?? '').trim() }))
      .filter((v) => v.value !== '');
  };

  const runningTotal = useMemo(() => {
    let sum = 0;
    for (const g of visibleGroups) {
      if (g.input_type === 'text') {
        sum += (Number(textGroupPrice[g.id]) || 0) / VAT;
        continue;
      }
      const a = answers[g.id];
      if (a && a !== 'skip') sum += priceOf(a);
    }
    return sum;
  }, [visibleGroups, answers, textGroupPrice, addonPrices, addons, product, variation]);

  const select = (value) => setAnswers((p) => ({ ...p, [current.id]: value }));
  const skip = () => setAnswers((p) => ({ ...p, [current.id]: 'skip' }));
  const setField = (groupId, key, val) =>
    setFieldValues((p) => ({ ...p, [groupId]: { ...(p[groupId] || {}), [key]: val } }));
  const setTextPrice = (groupId, val) =>
    setTextGroupPrice((p) => ({ ...p, [groupId]: val }));

  // Per-step status + a short answer summary, for the sidebar.
  const stepInfo = (g) => {
    if (g.input_type === 'text') {
      const vals = textValuesOf(g);
      const price = Number(textGroupPrice[g.id]) || 0;
      const parts = vals.map((v) => v.value);
      if (price > 0) parts.push(`+${fmt(price)}`);
      return { done: vals.length > 0 || price > 0, answer: parts.join(' · ') || '—' };
    }
    const a = answers[g.id];
    if (a === 'skip') return { done: true, answer: 'דולג' };
    if (a) {
      const p = priceOf(a);
      return { done: true, answer: p > 0 ? `${a.label} (+${fmt(withVat(p))})` : a.label };
    }
    return { done: false, answer: '—' };
  };

  const finish = () => {
    const lines = [];
    const fields = [];
    for (const g of visibleGroups) {
      if (g.input_type === 'text') {
        // Text fields ride on the bed item as metadata (bed_config_fields).
        const values = textValuesOf(g);
        if (values.length) fields.push({ group_key: g.key, group_label: g.label, values });
        // An optional charge the rep typed becomes a normal priced line, tagged
        // so we can re-read it into the price box on edit.
        const priceInc = Number(textGroupPrice[g.id]) || 0;
        if (priceInc > 0) {
          const summary = values.map((v) => v.value).join(' · ');
          lines.push({
            product_id: '', variation_id: '', sku: '',
            name: `${g.label}${summary ? ` — ${summary}` : ''}`,
            quantity: 1, unit_price: priceInc / VAT, discount_percent: 0, total: priceInc / VAT,
            selected_addons: [],
            bed_config_owner: token || '',
            bed_config_group_key: g.key,
            bed_config_value_key: '__text_charge__',
          });
        }
        continue;
      }
      const a = answers[g.id];
      if (!a || a === 'skip') continue;
      const price = priceOf(a);
      lines.push({
        product_id: '',
        variation_id: '',
        sku: '',
        name: `${g.label} — ${a.label}`,
        quantity: 1,
        unit_price: price,
        discount_percent: 0,
        total: price,
        selected_addons: [],
        bed_config_owner: token || '',
        bed_config_group_key: g.key,
        bed_config_value_key: a.key,
      });
    }
    onConfirm(lines, fields);
    onOpenChange(false);
  };

  const loading = gL || vL;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Adaptive-but-bounded size with a step sidebar: height follows the
          viewport (80vh) but is clamped to [400px, 680px] — never huge on a big
          monitor, never tiny on a laptop, and the same for every step so it
          doesn't jump. Only the question area scrolls. */}
      <DialogContent className="max-w-4xl w-[95vw] h-[80vh] min-h-[400px] max-h-[680px] p-0 gap-0 flex flex-col overflow-hidden" dir="rtl">
        <DialogHeader className="shrink-0 px-5 py-3.5 border-b border-border bg-muted/30 space-y-0 text-right">
          <DialogTitle className="flex items-center gap-2 text-base">
            <BedDouble className="h-5 w-5 text-primary" />
            תצורת מיטה{product?.name ? ` — ${product.name}` : ''}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : visibleGroups.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center text-sm text-muted-foreground px-6">
            לא הוגדרו שאלות תצורה פעילות. אפשר להגדיר אותן ב"קטלוג מוצרים → תצורת מיטות".
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex">
            {/* Sidebar (right in RTL): every question, its status and answer,
                clickable to jump. Turns the wizard into a clear checklist. */}
            <aside className="hidden sm:flex w-64 shrink-0 flex-col border-s border-border bg-muted/20">
              <div className="px-3 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                שלבים ({visibleGroups.length})
              </div>
              <ol className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
                {visibleGroups.map((g, i) => {
                  const info = stepInfo(g);
                  const isCur = i === step;
                  return (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => setStep(i)}
                        className={`w-full text-right flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                          isCur ? 'bg-primary/10' : 'hover:bg-muted'
                        }`}
                      >
                        <span className={`mt-0.5 shrink-0 flex items-center justify-center h-5 w-5 rounded-full text-[11px] font-bold ${
                          isCur ? 'bg-primary text-primary-foreground'
                            : info.done ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-background text-muted-foreground border border-border'
                        }`}>
                          {info.done && !isCur ? <Check className="h-3 w-3" /> : i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-xs font-medium leading-tight ${isCur ? 'text-primary' : 'text-foreground'}`}>{g.label}</span>
                          <span className={`block text-[11px] leading-tight truncate ${info.done ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>{info.answer}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div className="shrink-0 border-t border-border px-3 py-2.5 text-xs">
                <span className="text-muted-foreground">סה״כ תוספות: </span>
                <span className="font-bold text-primary">{fmt(withVat(runningTotal))}</span>
                <span className="text-muted-foreground"> כולל מע״מ</span>
              </div>
            </aside>

            {/* Main column */}
            <div className="flex-1 min-w-0 flex flex-col">
              {/* Compact progress bar (mobile fallback for the sidebar) */}
              <div className="sm:hidden shrink-0 px-4 pt-3 flex items-center gap-1.5">
                {visibleGroups.map((g, i) => (
                  <div key={g.id} className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-primary' : i === step ? 'bg-primary/60' : 'bg-muted'}`} />
                ))}
              </div>

              {/* Question — the only scrolling region. my-auto centers short
                  questions; tall ones scroll from the top. */}
              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col">
                <div className="my-auto w-full">
                <div className="flex items-baseline justify-between gap-2 mb-4">
                  <h3 className="text-lg font-semibold">{current.label}</h3>
                  <span className="text-xs text-muted-foreground shrink-0">שאלה {step + 1}/{visibleGroups.length}</span>
                </div>

                {isTextGroup ? (
                  <div className="space-y-4 max-w-lg">
                    <div className="space-y-3">
                      {(valuesByGroup.get(current.id) || []).map((f) => {
                        const val = fieldValues[current.id]?.[f.key] ?? '';
                        const opts = Array.isArray(f.options) ? f.options : [];
                        if (f.field_type === 'select' && opts.length) {
                          // 'אחר' is the sentinel for "type your own": when the stored
                          // value isn't one of the listed options, show the free-text box.
                          const isOther = val === BED_FIELD_OTHER || (val !== '' && !opts.includes(val));
                          const selectValue = opts.includes(val) ? val : (val !== '' ? BED_FIELD_OTHER : '');
                          return (
                            <div key={f.id} className="space-y-1.5">
                              <label className="text-sm font-medium">{f.label}</label>
                              <select
                                value={selectValue}
                                onChange={(e) => setField(current.id, f.key, e.target.value)}
                                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                              >
                                <option value="">בחר…</option>
                                {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                              </select>
                              {isOther ? (
                                <Input
                                  value={val === BED_FIELD_OTHER ? '' : val}
                                  onChange={(e) => setField(current.id, f.key, e.target.value || BED_FIELD_OTHER)}
                                  placeholder={`${f.label} — פרט`}
                                  className="h-9"
                                />
                              ) : null}
                            </div>
                          );
                        }
                        return (
                          <div key={f.id} className="space-y-1.5">
                            <label className="text-sm font-medium">{f.label}</label>
                            <Input
                              value={val}
                              onChange={(e) => setField(current.id, f.key, e.target.value)}
                              placeholder={f.label}
                              className="h-9"
                            />
                          </div>
                        );
                      })}
                      {(valuesByGroup.get(current.id) || []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">לא הוגדרו שדות לשאלה זו.</p>
                      ) : null}
                    </div>

                    {/* Optional extra charge for this text answer (e.g. a fabric
                        that isn't free). Left blank = no charge. */}
                    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-3 space-y-1.5">
                      <label className="text-sm font-medium flex items-center gap-1.5">
                        תוספת מחיר
                        <span className="text-[11px] font-normal text-muted-foreground">(אופציונלי)</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground text-sm">₪</span>
                        <Input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={textGroupPrice[current.id] ?? ''}
                          onChange={(e) => setTextPrice(current.id, e.target.value)}
                          placeholder="0"
                          className="h-9 w-36"
                        />
                        <span className="text-xs text-muted-foreground">כולל מע״מ</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">אם הבד כרוך בתוספת תשלום — הזינו את המחיר; אחרת השאירו ריק.</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    {(valuesByGroup.get(current.id) || []).map((v) => {
                      const selected = answered && answered !== 'skip' && answered.id === v.id;
                      const price = priceOf(v);
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => select(v)}
                          className={`relative flex flex-col rounded-xl border-2 overflow-hidden text-right transition-all ${
                            selected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/40'
                          }`}
                        >
                          {selected && (
                            <span className="absolute top-2 start-2 z-10 rounded-full bg-primary text-primary-foreground p-1">
                              <Check className="h-3.5 w-3.5" />
                            </span>
                          )}
                          <div className="aspect-[4/3] w-full bg-muted flex items-center justify-center">
                            {v.image_url ? (
                              <img src={v.image_url} alt={v.label} className="h-full w-full object-cover" />
                            ) : (
                              <BedDouble className="h-8 w-8 text-muted-foreground/40" />
                            )}
                          </div>
                          <div className="p-2.5">
                            <div className="text-sm font-medium leading-tight">{v.label}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {price > 0 ? `${fmt(withVat(price))} כולל מע״מ` : 'ללא תוספת מחיר'}
                            </div>
                            {v.note ? (() => {
                              const nt = getBedNoteType(v.note_type);
                              return (
                                <div className={`mt-1.5 text-[11px] leading-snug rounded border px-1.5 py-1 ${nt.badge}`}>
                                  <span className="font-semibold">{nt.label}: </span>{v.note}
                                </div>
                              );
                            })() : null}
                          </div>
                        </button>
                      );
                    })}

                    {current.skippable !== false && (
                      <button
                        type="button"
                        onClick={skip}
                        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed text-muted-foreground transition-all min-h-[7rem] ${
                          answered === 'skip' ? 'border-primary/60 text-primary' : 'border-border hover:border-primary/40'
                        }`}
                      >
                        <SkipForward className="h-6 w-6 mb-1" />
                        <span className="text-sm">דלג על שלב זה</span>
                      </button>
                    )}
                  </div>
                )}
                </div>
              </div>

              {/* Footer */}
              <div className="shrink-0 flex items-center justify-between gap-3 border-t border-border px-5 py-3">
                <div className="text-sm sm:hidden">
                  <span className="text-muted-foreground">סה״כ: </span>
                  <span className="font-semibold">{fmt(withVat(runningTotal))}</span>
                </div>
                <div className="hidden sm:block text-xs text-muted-foreground">
                  שלב {step + 1} מתוך {visibleGroups.length}
                </div>
                <div className="flex items-center gap-2">
                  {step > 0 && (
                    <Button type="button" variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))}>
                      חזור
                    </Button>
                  )}
                  {isLast ? (
                    <Button type="button" onClick={finish} disabled={!canProceed}>
                      הוסף להצעה
                    </Button>
                  ) : (
                    <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canProceed}>
                      המשך
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
