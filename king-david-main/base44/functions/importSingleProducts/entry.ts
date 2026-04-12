import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Same product order as double products, with single bed base prices (80x190)
const SINGLE_PRODUCTS_DATA = [
  { sku: "3MK", name: "3M קומפורט חטיבת היוקרה", basePrice: 5315 },
  { sku: "AN", name: "אנטומי אורטופדי לטקס", basePrice: 1955 },
  { sku: "ANP", name: "אנטומי אורטופדי לטקס פילוטופ", basePrice: 2280 },
  { sku: "CAR", name: "Carbon Pro X7 / קארבון פרו", basePrice: 3245 },
  { sku: "EGV", name: "אלגנס רזידנס קפיצי פוקט (ויסקו)", basePrice: 3830 },
  { sku: "EM", name: "אלסטיק מדיק בד אלוורה", basePrice: 1758 },
  { sku: "EMP", name: "אלסטיק מדיק פילו' בד אלוורה", basePrice: 2355 },
  { sku: "EN", name: "אנרג'י (קשיח ללא קפיצים)", basePrice: 1758 },
  { sku: "ENP", name: "אנרג'י פילוטופ (קשיח ללא קפיצים)", basePrice: 2355 },
  { sku: "EXVP", name: "אקסלנט קינג הייבריד", basePrice: 3440 },
  { sku: "HLP", name: "הולידיי פילוטופ צד אחד", basePrice: 2883 },
  { sku: "HR", name: "הרמוני מולטי ויסקו", basePrice: 4208 },
  { sku: "I", name: "אימפקט", basePrice: 2980 },
  { sku: "IMP", name: "אינטר מדיק ויסקו פילוטופ", basePrice: 2880 },
  { sku: "INS", name: "אינספייר קפיצי פוקט", basePrice: 2950 },
  { sku: "K1", name: "קוואטרו K", basePrice: 6415 },
  { sku: "KA", name: "קשמיר ויסקו", basePrice: 3108 },
  { sku: "KS", name: "קוואטרו מולטי ויסקו ללא קפיצים S", basePrice: 6415 },
  { sku: "LEDH", name: "לידר דו צדדי 2023 (חצי קשיח ללא קפיצים)", basePrice: 3435 },
  { sku: "LP", name: "מולטי לטקס פרימייר", basePrice: 2485 },
  { sku: "MS", name: "מדיק ספורט (קשיח ללא קפיצים)", basePrice: 1758 },
  { sku: "MSB", name: "מדיק ספורט בד במבו (קשיח ללא קפיצים)", basePrice: 1758 },
  { sku: "N", name: "נייט תראפי", basePrice: 3685 },
  { sku: "NS", name: "נטורל ספא דאבל קדר", basePrice: 2485 },
  { sku: "NSP", name: "נטורל ספא פילוטופ (ויסקו)", basePrice: 3135 },
  { sku: "NTP", name: "נטורל תראפי לטקס/ויסקו פילו'", basePrice: 3190 },
  { sku: "OLVP", name: "אופוריה קפיצים לטקס/ויסקו דו צדדי", basePrice: 3483 },
  { sku: "OM", name: "אורטו מדיקל", basePrice: 2985 },
  { sku: "OTP1", name: "אורטו טבע פילוטופ צד 1", basePrice: 2950 },
  { sku: "PRP", name: 'פרפקשיין לטקס(פוקט) פילוטופ 8 ס"מ צד 1', basePrice: 3858 },
  { sku: "PRPV", name: 'פרפקשיין ויסקו(פוקט) פילוטופ 8 ס"מ צד 1', basePrice: 3858 },
  { sku: "RTP", name: "רילקס תארפי ויסקו פילוטופ", basePrice: 2485 },
  { sku: "SILK", name: "סילבר קר פוקט", basePrice: 3108 },
  { sku: "TDP", name: "טריפל בלאנס דבל פילוטופ", basePrice: 5315 },
  { sku: "VDL", name: "ויסקו דה לקס", basePrice: 1955 },
  { sku: "VDLP", name: "ויסקו דלקס פילוטופ פלוס", basePrice: 2733 },
  { sku: "VM", name: "ויסקו מדיק פילוטופ", basePrice: 3258 },
  { sku: "VP", name: "מולטי ויסקו פרימייר", basePrice: 2485 },
  { sku: "SPACE", name: "ספייס פילוטופ", basePrice: 2355 },
  { sku: "ULT1", name: "אולטימייט", basePrice: 2180 },
];

// Single bed size surcharges relative to base price (80x190)
const SINGLE_SIZE_SURCHARGES = [
  { width: 80, length: 190, surcharge: 0 },
  { width: 80, length: 200, surcharge: 300 },
  { width: 90, length: 190, surcharge: 300 },
  { width: 90, length: 200, surcharge: 490 },
  { width: 100, length: 190, surcharge: 490 },
  { width: 100, length: 200, surcharge: 490 },
  { width: 120, length: 190, surcharge: 990 },
  { width: 120, length: 200, surcharge: 1390 },
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
    for (let i = 0; i < SINGLE_PRODUCTS_DATA.length; i += 10) {
      const batch = SINGLE_PRODUCTS_DATA.slice(i, i + 10);
      const productBatch = batch.map(p => ({
        name: p.name,
        category: 'mattress',
        bed_type: 'single',
        is_active: true,
      }));

      const createdProducts = await base44.asServiceRole.entities.Product.bulkCreate(productBatch);
      results.productsCreated += createdProducts.length;

      // Create variations for each product
      for (let j = 0; j < createdProducts.length; j++) {
        const product = createdProducts[j];
        const productData = batch[j];

        const variations = SINGLE_SIZE_SURCHARGES.map(size => ({
          product_id: product.id,
          sku: `${productData.sku}-S${size.width}${size.length}`,
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
      console.log(`Batch ${Math.floor(i/10) + 1}: Created ${createdProducts.length} single products with variations`);
    }

    console.log(`Done! Products: ${results.productsCreated}, Variations: ${results.variationsCreated}`);
    return Response.json({
      success: true,
      productsCreated: results.productsCreated,
      variationsCreated: results.variationsCreated,
      expectedVariations: SINGLE_PRODUCTS_DATA.length * SINGLE_SIZE_SURCHARGES.length,
    });
  } catch (error) {
    console.error('Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});