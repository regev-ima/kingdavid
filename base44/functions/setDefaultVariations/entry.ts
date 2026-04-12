import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Get all products
    const products = await base44.asServiceRole.entities.Product.list('-created_date', 200);
    console.log(`Found ${products.length} products`);

    // Get all variations
    let allVariations = [];
    let skip = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.ProductVariation.list('-created_date', 200, skip);
      allVariations.push(...batch);
      if (batch.length < 200) break;
      skip += 200;
      await delay(500);
    }
    console.log(`Found ${allVariations.length} variations`);

    let updated = 0;
    for (const product of products) {
      // For double beds: default is 140x190, for single beds: default is 80x190
      const isDouble = product.bed_type === 'double';
      const defaultWidth = isDouble ? 140 : 80;
      const defaultLength = 190;

      const defaultVar = allVariations.find(
        v => v.product_id === product.id && v.width_cm === defaultWidth && v.length_cm === defaultLength
      );

      if (defaultVar && product.default_variation_id !== defaultVar.id) {
        await base44.asServiceRole.entities.Product.update(product.id, {
          default_variation_id: defaultVar.id
        });
        updated++;
        if (updated % 10 === 0) await delay(500);
      }
    }

    console.log(`Updated ${updated} products with default variation`);
    return Response.json({ success: true, updated });
  } catch (error) {
    console.error('Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});