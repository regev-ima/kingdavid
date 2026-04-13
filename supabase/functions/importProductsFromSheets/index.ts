import { createServiceClient, getUser, corsHeaders } from '../_shared/supabase.ts';

const SPREADSHEET_ID = '1o2KSCJX3l9jKMvyVVU1gHLnK7hvEx_iF-01cjGeq0tQ';

const SHEETS = [
  { name: 'מחירון מזרונים - זוגי 2026', category: 'mattress', bed_type: 'double' },
  { name: 'מחירון מזרונים - יחיד 2026', category: 'mattress', bed_type: 'single' },
  { name: ' מחירון מיטות - זוגי 2026', category: 'bed', bed_type: 'double' },
  { name: ' מחירון מיטות - יחיד 2026', category: 'bed', bed_type: 'single' },
];

async function fetchSheet(apiKey: string, sheetName: string) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch sheet "${sheetName}": ${await res.text()}`);
  const data = await res.json();
  return data.values || [];
}

function parsePrice(val: string): number {
  if (!val) return 0;
  return Number(String(val).replace(/[,"₪\s]/g, '')) || 0;
}

function parseSize(val: string): { width: number; length: number } {
  if (!val) return { width: 0, length: 0 };
  const parts = val.split('/').map(s => Number(s.trim()) || 0);
  return { width: parts[0] || 0, length: parts[1] || 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createServiceClient();
    const apiKey = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    if (!apiKey) return Response.json({ error: 'GOOGLE_SHEETS_API_KEY not set' }, { status: 500, headers: corsHeaders });

    const results: any = { products_created: 0, variations_created: 0, sheets_processed: 0, errors: [] };

    for (const sheet of SHEETS) {
      try {
        const rows = await fetchSheet(apiKey, sheet.name);
        if (rows.length < 2) {
          results.errors.push(`Sheet "${sheet.name}" is empty`);
          continue;
        }

        // Skip header row
        const dataRows = rows.slice(1);

        // Group by product name (column index 2 = שם פריט)
        const productMap = new Map<string, any[]>();

        for (const row of dataRows) {
          const sku = row[1]?.trim();
          const productName = row[2]?.trim();
          const size = row[3]?.trim();
          const basePrice = row[4];

          if (!productName || !sku) continue;

          if (!productMap.has(productName)) {
            productMap.set(productName, []);
          }
          productMap.get(productName)!.push({ sku, size, basePrice });
        }

        const bedLabel = sheet.bed_type === 'double' ? 'זוגי' : 'יחיד';
        const skuSuffix = sheet.bed_type === 'double' ? '-D' : '-S';

        // Insert products and variations
        for (const [productName, variations] of productMap) {
          const fullProductName = `${productName} (${bedLabel})`;

          // Check if product already exists
          const { data: existing } = await supabase
            .from('products')
            .select('id')
            .eq('name', fullProductName)
            .limit(1);

          let productId: string;

          if (existing && existing.length > 0) {
            productId = existing[0].id;
          } else {
            const { data: newProduct, error: prodError } = await supabase
              .from('products')
              .insert({
                name: fullProductName,
                sku: variations[0].sku.replace(/\d{6}$/, '') + skuSuffix,
                is_active: true,
                category: sheet.category,
                bed_type: sheet.bed_type,
              })
              .select()
              .single();

            if (prodError) {
              results.errors.push(`Product "${productName}": ${prodError.message}`);
              continue;
            }
            productId = newProduct.id;
            results.products_created++;
          }

          // Insert variations
          for (const v of variations) {
            const { width, length } = parseSize(v.size);
            const price = parsePrice(v.basePrice);

            const uniqueSku = v.sku + skuSuffix;

            const { data: existingVar } = await supabase
              .from('product_variations')
              .select('id')
              .eq('sku', uniqueSku)
              .limit(1);

            if (existingVar && existingVar.length > 0) continue; // Skip existing

            const { error: varError } = await supabase
              .from('product_variations')
              .insert({
                product_id: productId,
                sku: uniqueSku,
                name: `${productName} ${v.size}`,
                width_cm: width,
                length_cm: length,
                base_price: price,
                final_price: price,
                is_active: true,
              });

            if (varError) {
              results.errors.push(`Variation "${v.sku}": ${varError.message}`);
            } else {
              results.variations_created++;
            }
          }
        }

        results.sheets_processed++;
      } catch (err) {
        results.errors.push(`Sheet "${sheet.name}": ${(err as Error).message}`);
      }
    }

    return Response.json(results, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500, headers: corsHeaders });
  }
});
