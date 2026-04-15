#!/usr/bin/env node
/**
 * Seed ~50 test shipments across 6 regions to exercise the scheduling +
 * geocoding pipeline. Run ONCE against a dev/staging database.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seedTestShipments.mjs
 *
 * After running, trigger geocoding with:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/geocodeSeedShipments.mjs
 *
 * Safety:
 *   - All seeded rows have notes = 'SEED_TEST_SHIPMENT' so they are easy to delete:
 *     DELETE FROM delivery_shipments WHERE notes = 'SEED_TEST_SHIPMENT';
 *   - The script aborts if the env vars aren't set, so it can't accidentally
 *     run against prod without explicit credentials.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Test data - 50 shipments spread across 6 regions with real-ish addresses
// so Google Geocoding returns distinct lat/lng within the same city.
// ---------------------------------------------------------------------------
const SEED = [
  // North (8)
  { city: 'חיפה',          address: 'דרך הים 145',         tw: 'morning'   },
  { city: 'חיפה',          address: 'שדרות בן גוריון 38',   tw: 'morning'   },
  { city: 'חיפה',          address: 'הרצל 72',              tw: 'afternoon' },
  { city: 'נהריה',         address: 'הגעתון 50',            tw: 'morning'   },
  { city: 'כרמיאל',        address: 'שדרות נשיאי ישראל 10', tw: 'afternoon' },
  { city: 'עפולה',         address: 'יהושע חנקין 24',       tw: 'morning'   },
  { city: 'חדרה',          address: 'הגיבורים 40',          tw: 'afternoon' },
  { city: 'זכרון יעקב',    address: 'המייסדים 62',          tw: 'morning'   },

  // Center (10)
  { city: 'תל אביב',       address: 'אבן גבירול 120',       tw: 'morning'   },
  { city: 'תל אביב',       address: 'דיזנגוף 210',          tw: 'afternoon' },
  { city: 'תל אביב',       address: 'אלנבי 85',             tw: 'morning'   },
  { city: 'רמת גן',        address: 'ביאליק 40',            tw: 'afternoon' },
  { city: 'פתח תקווה',     address: 'ההגנה 70',             tw: 'morning'   },
  { city: 'פתח תקווה',     address: 'ז׳בוטינסקי 155',       tw: 'afternoon' },
  { city: 'ראשון לציון',   address: 'הרצל 88',              tw: 'morning'   },
  { city: 'חולון',         address: 'סוקולוב 32',           tw: 'afternoon' },
  { city: 'רחובות',        address: 'הרצל 200',             tw: 'morning'   },
  { city: 'מודיעין',       address: 'עמק דותן 4',           tw: 'afternoon' },

  // Sharon (9)
  { city: 'רעננה',         address: 'אחוזה 118',            tw: 'morning'   },
  { city: 'רעננה',         address: 'ויצמן 75',             tw: 'morning'   },
  { city: 'רעננה',         address: 'הרצל 30',              tw: 'afternoon' },
  { city: 'כפר סבא',       address: 'ויצמן 150',            tw: 'morning'   },
  { city: 'כפר סבא',       address: 'טשרניחובסקי 20',       tw: 'afternoon' },
  { city: 'הוד השרון',     address: 'דרך רמתיים 80',        tw: 'morning'   },
  { city: 'תל מונד',       address: 'הדקל 14',              tw: 'afternoon' },
  { city: 'אבן יהודה',     address: 'המייסדים 7',           tw: 'morning'   },
  { city: 'נתניה',         address: 'הרצל 25',              tw: 'afternoon' },

  // Shomron (6)
  { city: 'אריאל',         address: 'יהודה הנשיא 12',       tw: 'morning'   },
  { city: 'אריאל',         address: 'האירוסים 5',           tw: 'afternoon' },
  { city: 'קרני שומרון',   address: 'נווה מנחם 3',          tw: 'morning'   },
  { city: 'אלקנה',         address: 'הזית 8',               tw: 'morning'   },
  { city: 'עמנואל',        address: 'רחוב הגפן 2',          tw: 'afternoon' },
  { city: 'ברקן',          address: 'אזור התעשייה 10',      tw: 'morning'   },

  // Jerusalem (7)
  { city: 'ירושלים',       address: 'יפו 97',               tw: 'morning'   },
  { city: 'ירושלים',       address: 'עזה 25',               tw: 'afternoon' },
  { city: 'ירושלים',       address: 'קינג ג׳ורג׳ 15',       tw: 'morning'   },
  { city: 'בית שמש',       address: 'נהר הירדן 30',         tw: 'afternoon' },
  { city: 'מעלה אדומים',   address: 'המצפה 18',             tw: 'morning'   },
  { city: 'מבשרת ציון',    address: 'הרכס 22',              tw: 'afternoon' },
  { city: 'ביתר עילית',    address: 'הדף היומי 11',         tw: 'morning'   },

  // South (10)
  { city: 'באר שבע',       address: 'רגר 45',               tw: 'morning'   },
  { city: 'באר שבע',       address: 'הרצל 80',              tw: 'afternoon' },
  { city: 'באר שבע',       address: 'רח׳ העצמאות 33',       tw: 'morning'   },
  { city: 'אשדוד',         address: 'שבט גד 12',            tw: 'afternoon' },
  { city: 'אשדוד',         address: 'רוגוזין 50',           tw: 'morning'   },
  { city: 'אשקלון',        address: 'צה״ל 28',              tw: 'afternoon' },
  { city: 'קריית גת',      address: 'שדרות לכיש 60',        tw: 'morning'   },
  { city: 'נתיבות',        address: 'הרב בבא סאלי 4',       tw: 'afternoon' },
  { city: 'שדרות',         address: 'מנחם בגין 18',         tw: 'morning'   },
  { city: 'דימונה',        address: 'הרצל 22',              tw: 'afternoon' },
];

const HEBREW_FIRST_NAMES = [
  'דוד', 'משה', 'יוסי', 'רונית', 'שרה', 'מירי', 'אבי', 'רמי', 'תמר', 'חנה',
  'יעל', 'אורי', 'גיל', 'נועה', 'עדי', 'אלון', 'שירלי', 'דני', 'מיכל', 'אייל',
];
const HEBREW_LAST_NAMES = [
  'כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'חדד', 'אברהם', 'דוד', 'אזולאי', 'עמר',
  'סבג', 'דהן', 'חזן', 'אוחנה', 'אליהו',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function phoneNumber(i) {
  // deterministic fake mobile: 050-XXX-XXXX
  const suffix = String(1000000 + i).padStart(7, '0');
  return `050${suffix}`;
}

async function main() {
  // Get the highest existing shipment_number so we don't collide.
  const { data: existing, error: lookupError } = await supabase
    .from('delivery_shipments')
    .select('shipment_number')
    .order('created_date', { ascending: false })
    .limit(1);

  if (lookupError) {
    console.error('Could not look up existing shipments:', lookupError);
    process.exit(1);
  }

  const lastNumber = existing?.[0]?.shipment_number?.replace(/\D/g, '') || '90000';
  let nextNum = parseInt(lastNumber, 10) + 1;

  const rows = SEED.map((s, i) => ({
    shipment_number: `SHP${nextNum++}`,
    customer_name: `${pick(HEBREW_FIRST_NAMES)} ${pick(HEBREW_LAST_NAMES)}`,
    customer_phone: phoneNumber(i),
    address: s.address,
    city: s.city,
    time_window: s.tw,
    status: 'need_scheduling',
    notes: 'SEED_TEST_SHIPMENT',
  }));

  console.log(`Inserting ${rows.length} test shipments...`);
  const { data, error } = await supabase
    .from('delivery_shipments')
    .insert(rows)
    .select('id, shipment_number, city');

  if (error) {
    console.error('Insert failed:', error);
    process.exit(1);
  }

  console.log(`Inserted ${data.length} shipments:`);
  const byCity = data.reduce((acc, r) => {
    acc[r.city] = (acc[r.city] || 0) + 1;
    return acc;
  }, {});
  Object.entries(byCity)
    .sort(([, a], [, b]) => b - a)
    .forEach(([city, count]) => console.log(`  ${city}: ${count}`));

  console.log('\nNext step: run scripts/geocodeSeedShipments.mjs to populate lat/lng.');
  console.log('To remove: DELETE FROM delivery_shipments WHERE notes = \'SEED_TEST_SHIPMENT\';');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
