import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function ExpiringQuotesFromCounters({ quotes }) {
  const items = quotes || [];
  
  if (items.length === 0) return null;

  return (
    <Card className="border-orange-200/50 bg-orange-50/20 rounded-xl shadow-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
          <div className="p-1.5 rounded-md bg-orange-100">
            <AlertTriangle className="h-4 w-4 text-orange-600" />
          </div>
          הצעות מחיר שעומדות לפוג
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(quote => (
            <div key={quote.id} className="p-3 bg-white rounded-lg border border-orange-200 hover:shadow-sm transition-shadow">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm">#{quote.quote_number}</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-orange-100 text-orange-700">
                  {quote.days_left} יום
                </span>
              </div>
              <p className="text-sm text-foreground/80">{quote.customer_name}</p>
              <p className="text-lg font-bold text-primary">
                ₪{quote.total?.toLocaleString()}
              </p>
              <div className="mt-2">
                <Link to={createPageUrl('QuoteDetails') + `?id=${quote.id}`}>
                  <Button size="sm" variant="outline" className="w-full h-7 text-xs">
                    פרטים
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}