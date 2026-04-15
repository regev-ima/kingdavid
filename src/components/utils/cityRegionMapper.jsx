// מיפוי אוטומטי של ערים לאזורים גיאוגרפיים
// אזורי המשלוחים של קינג דיוויד: 6 אזורים
export const REGIONS = {
  north: 'צפון',
  center: 'מרכז',
  sharon: 'שרון',
  shomron: 'שומרון',
  jerusalem: 'ירושלים',
  south: 'דרום',
};

// סדר הבדיקה של ערי-אזורים בפונקציית getCityRegion חשוב:
// משייכים קודם את האזורים הממוקדים (sharon, shomron, jerusalem) ורק אחר-כך center/north/south,
// כי ערי שרון כמו "רעננה" עלולות ליפול ל-center אם center נבדק ראשון.
const CITY_REGIONS = {
  // שרון - נבדק לפני center כי רעננה/כפ"ס/הוד השרון הם חלק מהשרון
  sharon: [
    'רעננה', 'כפר סבא', 'הוד השרון', 'תל מונד', 'קדימה צורן', 'קדימה', 'צורן',
    'אבן יהודה', 'שערי תקווה', 'אלפי מנשה', 'אייל', 'גן חיים', 'בני ציון',
    'נורדיה', 'כפר יונה', 'גאולים',
  ],

  // שומרון - נבדק לפני center
  shomron: [
    'אריאל', 'קרני שומרון', 'עמנואל', 'ברקן', 'קדומים', 'עלי זהב',
    'פדואל', 'בית אריה', 'אורנית', 'אלקנה', 'יקיר', 'שבי שומרון',
    'איתמר', 'עלי', 'שילה', 'מעלה לבונה', 'רחלים', 'עלי עין',
  ],

  // ירושלים
  jerusalem: [
    'ירושלים', 'בית שמש', 'מעלה אדומים', 'מבשרת ציון', 'אבו גוש',
    'גוש עציון', 'אפרת', 'בית אל', 'ביתר עילית', 'צור הדסה', 'הר אדר',
  ],

  // צפון - מחוז הצפון, מחוז חיפה והגליל
  north: [
    // מחוז חיפה
    'חיפה', 'קריית ים', 'קריית מוצקין', 'קריית ביאליק', 'קריית אתא', 'נשר',
    'טירת כרמל', 'עספיא', 'דלית אל כרמל',
    // מחוז הצפון והגליל
    'נהריה', 'עכו', 'צפת', 'קריית שמונה', 'כרמיאל', 'מעלות תרשיחא',
    'נצרת', 'נצרת עילית', 'טבריה', 'בית שאן', 'עפולה', 'מגדל העמק',
    'יוקנעם', 'יקנעם עילית', 'שפרעם', 'סחנין', 'טמרה', 'ראמה',
    'מעלה גלבוע', 'רמת ישי', 'מגדל',
    // אזור חדרה (עוגן לצפון - קרוב יותר לחיפה מאשר לת"א)
    'חדרה', 'אור עקיבא', 'זכרון יעקב', 'בנימינה', 'קיסריה', 'חריש',
    'פרדס חנה כרכור', 'פרדס חנה',
  ],

  // מרכז - גוש דן, השפלה, המרכז (ללא השרון)
  center: [
    // מחוז תל אביב וגוש דן
    'תל אביב', 'תל אביב יפו', 'רמת גן', 'גבעתיים', 'בני ברק', 'חולון', 'בת ים',
    'רמת השרון', 'הרצליה', 'אור יהודה', 'קריית אונו', 'גבעת שמואל',
    // נתניה על הגבול - היסטורית שייכת למרכז
    'נתניה',
    // פתח תקווה וסביבה
    'פתח תקווה', 'ראש העין', 'אלעד', 'יהוד מונוסון', 'יהוד',
    // השפלה
    'ראשון לציון', 'רחובות', 'נס ציונה', 'יבנה', 'גדרה', 'רמלה', 'לוד',
    'מודיעין', 'מודיעין מכבים רעות', 'שוהם', 'מזכרת בתיה', 'קרית עקרון',
    'גן יבנה', 'באר יעקב',
  ],

  // דרום - מחוז הדרום והנגב (כולל קריית מלאכי - שם המפעל)
  south: [
    'באר שבע', 'אשדוד', 'אשקלון', 'קריית גת', 'קרית גת', 'שדרות', 'נתיבות',
    'אילת', 'דימונה', 'ערד', 'עראד', 'אופקים',
    'קריית מלאכי', 'קרית מלאכי',  // ← המפעל
    'גדרות', 'מצפה רמון', 'רהט', 'תל שבע',
    'להבים', 'עומר', 'מיתר', 'ניר עוז',
  ],
};

// סדר הבדיקה - חשוב! אזורים ממוקדים ראשונים.
const REGION_CHECK_ORDER = ['sharon', 'shomron', 'jerusalem', 'north', 'south', 'center'];

/**
 * מזהה את האזור הגיאוגרפי של עיר
 * @param {string} cityName - שם העיר
 * @returns {string|null} - אחד מ-REGIONS או null אם לא נמצא
 */
export function getCityRegion(cityName) {
  if (!cityName) return null;

  const normalizedCity = cityName.trim();

  for (const region of REGION_CHECK_ORDER) {
    const cities = CITY_REGIONS[region];
    const found = cities.find(
      (city) => normalizedCity.includes(city) || city.includes(normalizedCity),
    );
    if (found) return region;
  }

  return null;
}

/**
 * קבלת כל הערים באזור מסוים
 * @param {string} region
 * @returns {array}
 */
export function getCitiesByRegion(region) {
  return CITY_REGIONS[region] || [];
}

/**
 * קבלת שם האזור בעברית
 * @param {string} region
 * @returns {string}
 */
export function getRegionName(region) {
  return REGIONS[region] || region;
}

/**
 * חישוב מרחק משוער בין שתי ערים (לפי אזור, fallback בלבד).
 * המרחק האמיתי מחושב ב-edge function לפי lat/lng גיאוקודד.
 * @param {string} city1
 * @param {string} city2
 * @returns {number} - משקל מרחק (ככל שנמוך יותר, קרוב יותר)
 */
export function estimateDistance(city1, city2) {
  const region1 = getCityRegion(city1);
  const region2 = getCityRegion(city2);

  if (region1 === region2) return 1;

  // מפת מרחקים יחסיים בין אזורים
  const distanceMap = {
    'sharon-center': 1,
    'sharon-north': 2,
    'sharon-shomron': 2,
    'sharon-jerusalem': 3,
    'sharon-south': 3,
    'shomron-center': 2,
    'shomron-jerusalem': 2,
    'shomron-north': 3,
    'shomron-south': 4,
    'center-jerusalem': 2,
    'center-south': 2,
    'center-north': 2,
    'north-jerusalem': 3,
    'north-south': 4,
    'jerusalem-south': 2,
  };

  const key1 = `${region1}-${region2}`;
  const key2 = `${region2}-${region1}`;

  return distanceMap[key1] || distanceMap[key2] || 5;
}
