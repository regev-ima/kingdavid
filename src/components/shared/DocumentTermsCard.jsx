import React from 'react';
import { FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DOCUMENT_TERMS_FIELDS, resolveDocumentTerms } from '@/constants/documentTerms';

/**
 * The three legal texts of a quote or an order, read-only.
 *
 * Always renders: a document saved before these fields existed shows the
 * defaults rather than an empty card — the terms apply either way, and "אני לא
 * רואה את התנאים" was the whole complaint. `doc` is the record itself and
 * `defaults` is what a blank field falls back to (for an order that's the
 * quote it came from, resolved against the company defaults).
 */
export default function DocumentTermsCard({ doc, defaults, title = 'תנאים' }) {
  const terms = resolveDocumentTerms(doc, defaults);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border/30">
        {DOCUMENT_TERMS_FIELDS.map((field) => (
          <div key={field.key} className="py-3 first:pt-0 last:pb-0">
            <p className="text-xs text-muted-foreground/80 mb-1.5">{field.label}</p>
            <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">
              {terms[field.key]}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
