import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";


import { TrendingUp, Plus, X, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';

export default function UpsellPanel({ quote, onAddItem }) {
  const { effectiveUser } = useEffectiveCurrentUser();
  const queryClient = useQueryClient();

  // Fetch upsell rules
  const { data: rules = [] } = useQuery({
    queryKey: ['upsellRules'],
    queryFn: () => base44.entities.UpsellRule.filter({ is_active: true }),
  });

  // Fetch product catalog
  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => base44.entities.ProductCatalog.list(),
  });

  // Fetch existing suggestions for this quote
  const { data: existingSuggestions = [] } = useQuery({
    queryKey: ['upsellSuggestions', quote?.id],
    queryFn: () => base44.entities.UpsellSuggestion.filter({ quote_id: quote?.id }),
    enabled: !!quote?.id,
  });

  const createSuggestionMutation = useMutation({
    mutationFn: (data) => base44.entities.UpsellSuggestion.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['upsellSuggestions']);
    },
  });

  const updateSuggestionMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.UpsellSuggestion.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['upsellSuggestions']);
    },
  });

  // Determine applicable suggestions based on items in quote
  const applicableSuggestions = rules.filter(rule => {
    const hasBaseProduct = quote?.items?.some(item => 
      item.name?.includes(rule.base_product) || item.sku?.includes(rule.base_product)
    );
    const alreadySuggested = existingSuggestions.some(s => 
      s.suggested_product === rule.recommended_product
    );
    return hasBaseProduct && !alreadySuggested;
  });

  const handleAddUpsell = async (rule) => {
    const product = products.find(p => 
      p.name.includes(rule.recommended_product) || p.sku.includes(rule.recommended_product)
    );

    if (!product) return;

    // Add to quote items
    onAddItem({
      sku: product.sku,
      name: product.name,
      quantity: 1,
      unit_price: product.price,
      discount_percent: rule.discount_percent || 0,
      total: product.price * (1 - (rule.discount_percent || 0) / 100)
    });

    // Log suggestion
    await createSuggestionMutation.mutateAsync({
      lead_id: quote.lead_id,
      quote_id: quote.id,
      suggested_product: rule.recommended_product,
      suggested_sku: product.sku,
      status: 'added',
      rep_id: effectiveUser?.email,
      script_shown: rule.script_hint
    });
  };

  const handleDecline = async (rule, reason) => {
    await createSuggestionMutation.mutateAsync({
      lead_id: quote.lead_id,
      quote_id: quote.id,
      suggested_product: rule.recommended_product,
      status: 'declined',
      decline_reason: reason,
      rep_id: effectiveUser?.email,
      script_shown: rule.script_hint
    });
  };

  if (!applicableSuggestions.length) return null;

  return (
    <Card className="border-primary/20 bg-primary/[0.03]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-primary">
          <Lightbulb className="h-5 w-5" />
          המלצות Upsell
          <Badge className="bg-primary/10 text-primary">{applicableSuggestions.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {applicableSuggestions.map((rule, idx) => (
          <UpsellItem
            key={idx}
            rule={rule}
            products={products}
            onAdd={() => handleAddUpsell(rule)}
            onDecline={(reason) => handleDecline(rule, reason)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function UpsellItem({ rule, products, onAdd, onDecline }) {
  const [showDeclineOptions, setShowDeclineOptions] = useState(false);
  const product = products.find(p => 
    p.name.includes(rule.recommended_product) || p.sku.includes(rule.recommended_product)
  );

  if (!product) return null;

  return (
    <div className="bg-card rounded-lg p-4 border border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-primary" />
            <p className="font-semibold text-foreground">{product.name}</p>
          </div>
          {rule.script_hint && (
            <p className="text-sm text-muted-foreground mb-2 italic">"{rule.script_hint}"</p>
          )}
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-primary">
              ₪{product.price.toLocaleString()}
            </span>
            {rule.discount_percent > 0 && (
              <Badge className="bg-green-100 text-green-700">
                -{rule.discount_percent}%
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button size="sm" onClick={onAdd}>
            <Plus className="h-4 w-4 me-1" />
            הוסף
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowDeclineOptions(!showDeclineOptions)}
          >
            <X className="h-4 w-4 me-1" />
            דחה
          </Button>
        </div>
      </div>

      {showDeclineOptions && (
        <div className="mt-3 pt-3 border-t space-y-2">
          <p className="text-xs text-muted-foreground mb-2">סיבת דחייה:</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: 'price', label: 'מחיר' },
              { value: 'not_needed', label: 'לא צריך' },
              { value: 'already_have', label: 'כבר יש' },
              { value: 'maybe_later', label: 'אולי בהמשך' }
            ].map(reason => (
              <Button
                key={reason.value}
                size="sm"
                variant="outline"
                onClick={() => {
                  onDecline(reason.value);
                  setShowDeclineOptions(false);
                }}
                className="text-xs"
              >
                {reason.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
