import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, BedDouble, Loader2, SkipForward } from 'lucide-react';
import { getBedNoteType, BED_VAT_RATE, BED_FIELD_OTHER } from '@/lib/bedConfig';

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
  const { data: groups = [], isLoading: gL } = useQuery({
    queryKey: ['bed-option-groups'],
    queryFn: () => base44.entities.BedOptionGroup.list('sort_order'),
    enabled: open,
  });
  const { data: values = [], isLoading: vL } = useQuery({
    queryKey: ['bed-option-values'],
    queryFn: () => base44.entities.BedOptionValue.list('sort_order'),
    enabled: open,
  });
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

  // Seed the answers once per open, after groups/values have loaded.
  const seedKey = open ? `${product?.id || ''}:${variation?.id || ''}:${token || ''}` : null;
  useEffect(() => {
    if (!open) { seededRef.current = null; return; }
    if (gL || vL) return; // wait for data
    if (seededRef.current === seedKey) return;
    setAnswers(initialAnswers);
    setFieldValues(initialFieldValues);
    setStep(0);
    seededRef.current = seedKey;
  }, [open, seedKey, gL, vL, initialAnswers, initialFieldValues]);

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

  const runningTotal = useMemo(() => {
    let sum = 0;
    for (const g of visibleGroups) {
      const a = answers[g.id];
      if (a && a !== 'skip') sum += priceOf(a);
    }
    return sum;
  }, [visibleGroups, answers, addonPrices, addons, product, variation]);

  const select = (value) => setAnswers((p) => ({ ...p, [current.id]: value }));
  const skip = () => setAnswers((p) => ({ ...p, [current.id]: 'skip' }));
  const setField = (groupId, key, val) =>
    setFieldValues((p) => ({ ...p, [groupId]: { ...(p[groupId] || {}), [key]: val } }));

  const finish = () => {
    const lines = [];
    const fields = [];
    for (const g of visibleGroups) {
      if (g.input_type === 'text') {
        // Collect the non-empty fields into one group entry on the bed item.
        const gv = fieldValues[g.id] || {};
        const values = (valuesByGroup.get(g.id) || [])
          .map((v) => ({ key: v.key, label: v.label, value: String(gv[v.key] ?? '').trim() }))
          .filter((v) => v.value !== '');
        if (values.length) fields.push({ group_key: g.key, group_label: g.label, values });
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
      {/* Fixed, roomy size — the dialog stays the same width/height for every
          question; only the middle question area scrolls, so it never jumps
          between steps. */}
      <DialogContent className="max-w-3xl w-[95vw] h-[85vh] flex flex-col overflow-hidden" dir="rtl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
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
          <>
            {/* Progress */}
            <div className="shrink-0 flex items-center gap-2">
              {visibleGroups.map((g, i) => (
                <div
                  key={g.id}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    i < step ? 'bg-primary' : i === step ? 'bg-primary/60' : 'bg-muted'
                  }`}
                />
              ))}
            </div>
            <p className="shrink-0 text-xs text-muted-foreground">שאלה {step + 1} מתוך {visibleGroups.length}</p>

            {/* Question — the only scrolling region, so the dialog size is constant */}
            <div className="flex-1 min-h-0 overflow-y-auto pe-1">
              <h3 className="text-lg font-semibold mb-3">{current.label}</h3>
              {isTextGroup ? (
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
              ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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

            {/* Footer */}
            <div className="shrink-0 flex items-center justify-between gap-3 border-t border-border pt-4">
              <div className="text-sm">
                <span className="text-muted-foreground">סה״כ תוספות: </span>
                <span className="font-semibold">{fmt(withVat(runningTotal))}</span>
                <span className="text-muted-foreground text-xs"> כולל מע״מ</span>
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
