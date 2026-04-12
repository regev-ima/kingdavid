import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const VAT_RATE = 1.18;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateWithRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.message?.includes('Rate limit') && attempt < maxRetries - 1) {
        await delay(2000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const onlyVariationIds = body?.only_variation_ids || null;

    // Fetch all product variations in batches
    const batchSize = 50;
    let offset = 0;
    let allVariations = [];
    
    while (true) {
      const batch = await base44.asServiceRole.entities.ProductVariation.filter({}, '-created_date', batchSize, offset);
      if (!batch || batch.length === 0) break;
      allVariations = allVariations.concat(batch);
      if (batch.length < batchSize) break;
      offset += batchSize;
    }

    // If only_variation_ids provided, filter to just those
    if (onlyVariationIds && Array.isArray(onlyVariationIds)) {
      const idSet = new Set(onlyVariationIds);
      allVariations = allVariations.filter(v => idSet.has(v.id));
    }

    console.log(`Found ${allVariations.length} product variations to update`);

    let updatedCount = 0;
    const errors = [];

    for (let i = 0; i < allVariations.length; i++) {
      const variation = allVariations[i];
      try {
        const updateData = {};
        
        if (variation.base_price != null && variation.base_price > 0) {
          updateData.base_price = Math.round(variation.base_price / VAT_RATE);
        }
        
        if (variation.final_price != null && variation.final_price > 0) {
          updateData.final_price = Math.round(variation.final_price / VAT_RATE);
        }

        if (Object.keys(updateData).length > 0) {
          await updateWithRetry(() => base44.asServiceRole.entities.ProductVariation.update(variation.id, updateData));
          updatedCount++;
          // Throttle: pause every 10 updates
          if (updatedCount % 10 === 0) {
            await delay(500);
          }
        }
      } catch (err) {
        errors.push({ id: variation.id, sku: variation.sku, error: err.message });
      }
    }

    // Also update ProductAddon base prices
    let allAddons = [];
    offset = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.ProductAddon.filter({}, '-created_date', batchSize, offset);
      if (!batch || batch.length === 0) break;
      allAddons = allAddons.concat(batch);
      if (batch.length < batchSize) break;
      offset += batchSize;
    }

    console.log(`Found ${allAddons.length} product addons to update`);
    let addonsUpdated = 0;

    for (const addon of allAddons) {
      try {
        const updateData = {};
        
        if (addon.base_price != null && addon.base_price > 0) {
          updateData.base_price = Math.round(addon.base_price / VAT_RATE);
        }

        if (addon.size_prices && Array.isArray(addon.size_prices) && addon.size_prices.length > 0) {
          updateData.size_prices = addon.size_prices.map(sp => ({
            ...sp,
            price: sp.price ? Math.round(sp.price / VAT_RATE) : sp.price
          }));
        }

        if (Object.keys(updateData).length > 0) {
          await updateWithRetry(() => base44.asServiceRole.entities.ProductAddon.update(addon.id, updateData));
          addonsUpdated++;
          await delay(300);
        }
      } catch (err) {
        errors.push({ id: addon.id, name: addon.name, error: err.message });
      }
    }

    // Also update ProductAddonPrice records
    let allAddonPrices = [];
    offset = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.ProductAddonPrice.filter({}, '-created_date', batchSize, offset);
      if (!batch || batch.length === 0) break;
      allAddonPrices = allAddonPrices.concat(batch);
      if (batch.length < batchSize) break;
      offset += batchSize;
    }

    console.log(`Found ${allAddonPrices.length} addon prices to update`);
    let addonPricesUpdated = 0;

    for (const ap of allAddonPrices) {
      try {
        if (ap.price != null && ap.price > 0) {
          await updateWithRetry(() => base44.asServiceRole.entities.ProductAddonPrice.update(ap.id, {
            price: Math.round(ap.price / VAT_RATE)
          }));
          addonPricesUpdated++;
          await delay(300);
        }
      } catch (err) {
        errors.push({ id: ap.id, error: err.message });
      }
    }

    return Response.json({
      success: true,
      variations_updated: updatedCount,
      variations_total: allVariations.length,
      addons_updated: addonsUpdated,
      addon_prices_updated: addonPricesUpdated,
      errors: errors.length > 0 ? errors : null,
      message: `עודכנו ${updatedCount} וריאציות, ${addonsUpdated} תוספות, ו-${addonPricesUpdated} מחירי תוספות. המע"מ (18%) הוסר מכל המחירים.`
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});