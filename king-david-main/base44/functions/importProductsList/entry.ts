import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const PRODUCTS_DATA = [
  { sku: "3MK", name: "3M קומפורט חטיבת היוקרה", basePrice: 9650 },
  { sku: "AN", name: "אנטומי אורטופדי לטקס", basePrice: 2930 },
  { sku: "ANP", name: "אנטומי אורטופדי לטקס פילוטופ", basePrice: 4780 },
  { sku: "CAR", name: "Carbon Pro X7 / קארבון פרו", basePrice: 6490 },
  { sku: "EGV", name: "אלגנס רזידנס קפיצי פוקט (ויסקו)", basePrice: 6680 },
  { sku: "EM", name: "אלסטיק מדיק בד אלוורה", basePrice: 2535 },
  { sku: "EMP", name: "אלסטיק מדיק פילו' בד אלוורה", basePrice: 3730 },
  { sku: "EN", name: "אנרג'י (קשיח ללא קפיצים)", basePrice: 2535 },
  { sku: "ENP", name: "אנרג'י פילוטופ (קשיח ללא קפיצים)", basePrice: 3730 },
  { sku: "EXVP", name: "אקסלנט קינג הייבריד", basePrice: 5900 },
  { sku: "HLP", name: "הולידיי פילוטופ צד אחד", basePrice: 4785 },
  { sku: "HR", name: "הרמוני מולטי ויסקו", basePrice: 7435 },
  { sku: "I", name: "אימפקט", basePrice: 4980 },
  { sku: "IMP", name: "אינטר מדיק ויסקו פילוטופ", basePrice: 4780 },
  { sku: "INS", name: "אינספייר קפיצי פוקט", basePrice: 5900 },
  { sku: "K1", name: "קוואטרו K", basePrice: 11850 },
  { sku: "KA", name: "קשמיר ויסקו", basePrice: 5235 },
  { sku: "KS", name: "קוואטרו מולטי ויסקו ללא קפיצים S", basePrice: 11850 },
  { sku: "LEDH", name: "לידר דו צדדי 2023 (חצי קשיח ללא קפיצים)", basePrice: 5890 },
  { sku: "LP", name: "מולטי לטקס פרימייר", basePrice: 3990 },
  { sku: "MS", name: "מדיק ספורט (קשיח ללא קפיצים)", basePrice: 2535 },
  { sku: "MSB", name: "מדיק ספורט בד במבו (קשיח ללא קפיצים)", basePrice: 2535 },
  { sku: "N", name: "נייט תראפי", basePrice: 6390 },
  { sku: "NS", name: "נטורל ספא דאבל קדר", basePrice: 3990 },
  { sku: "NSP", name: "נטורל ספא פילוטופ (ויסקו)", basePrice: 5290 },
  { sku: "NTP", name: "נטורל תראפי לטקס/ויסקו פילו'", basePrice: 6380 },
  { sku: "OLVP", name: "אופוריה קפיצים לטקס/ויסקו דו צדדי", basePrice: 5985 },
  { sku: "OM", name: "אורטו מדיקל", basePrice: 4990 },
  { sku: "OTP1", name: "אורטו טבע פילוטופ צד 1", basePrice: 4920 },
  { sku: "PRP", name: 'פרפקשיין לטקס(פוקט) פילוטופ 8 ס"מ צד 1', basePrice: 6735 },
  { sku: "PRPV", name: 'פרפקשיין ויסקו(פוקט) פילוטופ 8 ס"מ צד 1', basePrice: 6735 },
  { sku: "RTP", name: "רילקס תארפי ויסקו פילוטופ", basePrice: 3990 },
  { sku: "SILK", name: "סילבר קר פוקט", basePrice: 5235 },
  { sku: "TDP", name: "טריפל בלאנס דבל פילוטופ", basePrice: 9650 },
  { sku: "VDL", name: "ויסקו דה לקס", basePrice: 2930 },
  { sku: "VDLP", name: "ויסקו דלקס פילוטופ פלוס", basePrice: 4485 },
  { sku: "VM", name: "ויסקו מדיק פילוטופ", basePrice: 5535 },
  { sku: "VP", name: "מולטי ויסקו פרימייר", basePrice: 3990 },
  { sku: "SPACE", name: "ספייס פילוטופ", basePrice: 3730 },
  { sku: "ULT1", name: "אולטימייט", basePrice: 3380 },
];

// Size surcharges relative to base price (140x190)
const SIZE_SURCHARGES = [
  { width: 140, length: 190, surcharge: 0 },
  { width: 140, length: 200, surcharge: 300 },
  { width: 150, length: 190, surcharge: 300 },
  { width: 150, length: 200, surcharge: 490 },
  { width: 160, length: 190, surcharge: 490 },
  { width: 160, length: 200, surcharge: 490 },
  { width: 180, length: 200, surcharge: 990 },
  { width: 200, length: 200, surcharge: 1390 },
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const results = { productsCreated: 0, variationsCreated: 0, errors: [] };

    // Create products in batches
    for (let i = 0; i < PRODUCTS_DATA.length; i += 10) {
      const batch = PRODUCTS_DATA.slice(i, i + 10);
      const productBatch = batch.map(p => ({
        name: p.name,
        category: 'mattress',
        bed_type: 'double',
        is_active: true,
      }));

      const createdProducts = await base44.asServiceRole.entities.Product.bulkCreate(productBatch);
      results.productsCreated += createdProducts.length;

      // Create variations for each product
      for (let j = 0; j < createdProducts.length; j++) {
        const product = createdProducts[j];
        const productData = batch[j];

        const variations = SIZE_SURCHARGES.map(size => ({
          product_id: product.id,
          sku: `${productData.sku}${size.width}${size.length}`,
          length_cm: size.length,
          width_cm: size.width,
          height_cm: 0,
          base_price: productData.basePrice + size.surcharge,
          final_price: productData.basePrice + size.surcharge,
          discount_percent: 0,
          is_active: true,
        }));

        const createdVariations = await base44.asServiceRole.entities.ProductVariation.bulkCreate(variations);
        results.variationsCreated += createdVariations.length;
        await delay(300);
      }

      await delay(500);
      console.log(`Batch ${Math.floor(i/10) + 1}: Created ${createdProducts.length} products with variations`);
    }

    console.log(`Done! Products: ${results.productsCreated}, Variations: ${results.variationsCreated}`);
    return Response.json({
      success: true,
      productsCreated: results.productsCreated,
      variationsCreated: results.variationsCreated,
      expectedVariations: PRODUCTS_DATA.length * SIZE_SURCHARGES.length,
    });
  } catch (error) {
    console.error('Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});