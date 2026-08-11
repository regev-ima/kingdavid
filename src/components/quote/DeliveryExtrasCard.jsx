import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Sparkles, Info, Check, Plus, Trash2, PackageCheck } from 'lucide-react';

/**
 * The "תוספות" card — delivery & assembly charges on an order or a quote.
 *
 * One component for all three forms (NewOrder / NewQuote / EditQuote) rather
 * than three that resemble each other. The quote used to render a grid of
 * price tiles while the order rendered this; same charges, same decision, two
 * different screens to learn. Now the difference between them is the props.
 *
 * Three ways in, deliberately:
 *   • the dropdown, for anything in the catalog,
 *   • the recommendation chips, one click for what the items imply,
 *   • and the list below, which is the only place a charge can be removed —
 *     each row carries its own bin, and says so when we added it ourselves.
 *
 * `recommendOnly` changes just the wording of the recommendation line, for the
 * forms that offer a match without applying it (an order converted from a
 * quote, an existing quote the customer may already hold).
 */
export default function DeliveryExtrasCard({
  extras = [],
  selectableExtraCharges = [],
  recommendation = { extras: [], fallbackUsed: false },
  isSelfPickup = false,
  needsDelivery = false,
  recommendOnly = false,
  recommendOnlyLabel = '',
  selfPickupNote,
  onAdd,
  onRemove,
  onToggleRecommended,
  className = '',
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>תוספות</CardTitle>
        <Select onValueChange={onAdd}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="הוסף תוספת" />
          </SelectTrigger>
          <SelectContent>
            {selectableExtraCharges.map((ec) => (
              <SelectItem key={ec.id} value={ec.id}>
                {ec.name} - ₪{Number(ec.cost || 0).toLocaleString()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Delivery & assembly, matched to what's on the document. One click
            each; the row we picked ourselves says so on its badge. */}
        {isSelfPickup ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2 text-xs text-amber-800">
            <PackageCheck className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            {selfPickupNote || 'איסוף עצמי — תוספות הובלה והרכבה אינן רלוונטיות ואינן מוצעות.'}
          </div>
        ) : recommendation.extras.length > 0 ? (
          <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-3 space-y-2">
            <p className="text-xs font-medium text-primary flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              {recommendOnly
                ? (recommendOnlyLabel || 'מומלץ — לא נוסף אוטומטית')
                : 'זוהו תוספות הובלה והרכבה מתאימות'}
              {recommendation.fallbackUsed ? ' — התאמה כללית, כדאי לוודא' : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              {recommendation.extras.map((ec) => {
                const selected = extras.some((ex) => ex.extra_charge_id === ec.id);
                return (
                  <Button
                    key={ec.id}
                    type="button"
                    variant={selected ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => onToggleRecommended(ec)}
                  >
                    {selected ? <Check className="h-3 w-3 me-1" /> : <Plus className="h-3 w-3 me-1" />}
                    {ec.name} — ₪{Number(ec.cost || 0).toLocaleString()}
                  </Button>
                );
              })}
            </div>
          </div>
        ) : needsDelivery ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2 text-xs text-amber-800">
            <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            לא נמצאה תוספת הובלה מתאימה, יש לבחור ידנית.
          </div>
        ) : null}

        {extras.length === 0 ? (
          <p className="text-muted-foreground text-center py-4">לא נוספו תוספות</p>
        ) : (
          <div className="space-y-3">
            {extras.map((extra, index) => (
              <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex-1">
                  <p className="font-medium flex items-center gap-2 flex-wrap">
                    {extra.name}
                    {extra.auto_added ? (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
                        נוסף אוטומטית
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-lg">₪{Number(extra.cost || 0).toLocaleString()}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemove(index)}
                    className="text-red-500"
                    title="הסר תוספת"
                    aria-label={`הסר ${extra.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          מנוף ותוספת קומה אף פעם לא נוספים אוטומטית — יש לסכם אותם מול הלקוח ולהוסיף ידנית.
        </p>
      </CardContent>
    </Card>
  );
}
