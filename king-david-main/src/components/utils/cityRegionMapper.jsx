// מיפוי אוטומטי של ערים לאזורים גיאוגרפיים
export const REGIONS = {
  north: 'צפון',
  center: 'מרכז',
  south: 'דרום',
  jerusalem: 'ירושלים'
};

// מילון ערים לפי אזורים - מחולק לפי מחוזות ישראל הרשמיים
const CITY_REGIONS = {
  // צפון - מחוז הצפון, מחוז חיפה והגליל
  north: [
    // מחוז חיפה
    'חיפה', 'קריית ים', 'קריית מוצקין', 'קריית ביאליק', 'קריית אתא', 'נשר',
    'טירת כרמל', 'עספיא', 'דלית אל כרמל',
    // מחוז הצפון והגליל
    'נהריה', 'עכו', 'צפת', 'קריית שמונה', 'כרמיאל', 'מעלות תרשיחא',
    'נצרת', 'נצרת עילית', 'טבריה', 'בית שאן', 'עפולה', 'מגדל העמק',
    'יוקנעם', 'יקנעם עילית', 'שפרעם', 'סחנין', 'טמרה', 'ראמה',
    'מעלה גלבוע', 'קרית שלמה', 'רמת ישי', 'מגדל', 'פרדס חנה כרכור',
    // אזור חדרה (צפון מחוז המרכז)
    'חדרה', 'אור עקיבא', 'זכרון יעקב', 'בנימינה', 'קיסריה', 'חריש'
  ],
  
  // מרכז - מחוז המרכז, מחוז תל אביב, השפלה והשרון
  center: [
    // מחוז תל אביב וגוש דן
    'תל אביב', 'תל אביב יפו', 'רמת גן', 'גבעתיים', 'בני ברק', 'חולון', 'בת ים',
    'רמת השרון', 'הרצליה', 'אור יהודה', 'קריית אונו', 'גבעת שמואל',
    // מחוז המרכז - השרון
    'נתניה', 'רעננה', 'כפר סבא', 'הוד השרון', 'ראש העין', 'פתח תקווה',
    'אלעד', 'יהוד מונוסון', 'רמת גן',
    // השפלה והמרכז
    'ראשון לציון', 'רחובות', 'נס ציונה', 'יבנה', 'גדרה', 'רמלה', 'לוד',
    'מודיעין', 'מודיעין מכבים רעות', 'שוהם', 'מזכרת בתיה', 'קרית עקרון',
    'גן יבנה', 'באר יעקב', 'קריית מלאכי'
  ],
  
  // ירושלים - מחוז ירושלים והאזור
  jerusalem: [
    'ירושלים', 'בית שמש', 'מעלה אדומים', 'מבשרת ציון', 'אבו גוש',
    'גוש עציון', 'אפרת', 'בית אל', 'ביתר עילית'
  ],
  
  // דרום - מחוז הדרום והנגב
  south: [
    'באר שבע', 'אשדוד', 'אשקלון', 'קריית גת', 'שדרות', 'נתיבות',
    'אילת', 'דימונה', 'ערד', 'אופקים', 'נתיבות', 'יבנה',
    'קרית מלאכי', 'שדרות', 'אשדוד', 'אשקלון', 'ניר עוז',
    'גדרות', 'קריית מלאכי', 'מצפה רמון', 'רהט', 'תל שבע',
    'להבים', 'עומר', 'מיתר'
  ]
};

/**
 * מזהה את האזור הגיאוגרפי של עיר
 * @param {string} cityName - שם העיר
 * @returns {string|null} - north, center, south, jerusalem או null אם לא נמצא
 */
export function getCityRegion(cityName) {
  if (!cityName) return null;
  
  const normalizedCity = cityName.trim();
  
  for (const [region, cities] of Object.entries(CITY_REGIONS)) {
    const found = cities.find(city => 
      normalizedCity.includes(city) || city.includes(normalizedCity)
    );
    if (found) return region;
  }
  
  return null;
}

/**
 * קבלת כל הערים באזור מסוים
 * @param {string} region - north, center, south, jerusalem
 * @returns {array} - רשימת ערים
 */
export function getCitiesByRegion(region) {
  return CITY_REGIONS[region] || [];
}

/**
 * קבלת שם האזור בעברית
 * @param {string} region - north, center, south, jerusalem
 * @returns {string} - שם האזור בעברית
 */
export function getRegionName(region) {
  return REGIONS[region] || region;
}

/**
 * חישוב מרחק משוער בין שתי ערים (פונקציה פשוטה)
 * @param {string} city1
 * @param {string} city2
 * @returns {number} - משקל מרחק (ככל שנמוך יותר, קרוב יותר)
 */
export function estimateDistance(city1, city2) {
  const region1 = getCityRegion(city1);
  const region2 = getCityRegion(city2);
  
  if (region1 === region2) return 1; // אותו אזור
  
  // מפת מרחקים יחסיים בין אזורים
  const distanceMap = {
    'north-center': 2,
    'north-jerusalem': 3,
    'north-south': 4,
    'center-jerusalem': 2,
    'center-south': 2,
    'jerusalem-south': 2
  };
  
  const key1 = `${region1}-${region2}`;
  const key2 = `${region2}-${region1}`;
  
  return distanceMap[key1] || distanceMap[key2] || 5;
}