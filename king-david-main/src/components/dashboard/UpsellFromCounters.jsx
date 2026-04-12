import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp } from "lucide-react";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

const declineLabels = {
  price: 'מחיר',
  not_needed: 'לא צריך',
  already_have: 'כבר יש',
  maybe_later: 'אולי מאוחר יותר',
};

export default function UpsellFromCounters({ totalSuggestions, addedSuggestions, attachRate, topDecline, opportunities }) {
  const opps = opportunities || [];

  return (
    <Card className="border-border shadow-card rounded-xl overflow-hidden">
      <CardHeader className="pb-3 border-b border-border/50 bg-muted/50">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
          <div className="p-1.5 rounded-md bg-purple-100">
            <TrendingUp className="h-4 w-4 text-purple-600" />
          </div>
          ביצועי Upsell
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid grid-cols-4 gap-2 sm:gap-3 mb-4">
          <div className="text-center p-2.5 bg-primary/5 rounded-lg border border-primary/10">
            <p className="text-xl font-bold text-primary">{totalSuggestions}</p>
            <p className="text-xs text-muted-foreground mt-0.5">הצעות</p>
          </div>
          <div className="text-center p-2.5 bg-green-50 rounded-lg border border-green-100">
            <p className="text-xl font-bold text-green-600">{addedSuggestions}</p>
            <p className="text-xs text-muted-foreground mt-0.5">נוספו</p>
          </div>
          <div className="text-center p-2.5 bg-purple-50 rounded-lg border border-purple-100">
            <p className="text-xl font-bold text-purple-600">{attachRate}%</p>
            <p className="text-xs text-muted-foreground mt-0.5">Attach Rate</p>
          </div>
          <div className="text-center p-2.5 bg-muted rounded-lg border border-border/50">
            <p className="text-xs font-medium text-muted-foreground mb-0.5">סיבת דחייה</p>
            <p className="text-sm font-semibold text-foreground/80">
              {topDecline?.reason ? (declineLabels[topDecline.reason] || topDecline.reason) : '-'}
            </p>
          </div>
        </div>

        {opps.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
              הזדמנויות Upsell ({opps.length})
            </h4>
            <div className="space-y-2">
              {opps.map(quote => (
                <div key={quote.id} className="flex items-center justify-between p-2.5 bg-amber-50 rounded-lg border border-amber-100">
                  <div>
                    <p className="text-sm font-medium text-foreground">#{quote.quote_number}</p>
                    <p className="text-xs text-muted-foreground">{quote.customer_name}</p>
                  </div>
                  <Link to={createPageUrl('QuoteDetails') + `?id=${quote.id}`}>
                    <Button size="sm" variant="outline" className="h-7 text-xs">הצע Upsell</Button>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}