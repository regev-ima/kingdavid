# תוכנית עבודה — מודל "איש קשר → לידים", נרמול טלפונים, איחוד מקורות ואיפוס-וייבוא

> מסמך הכרעות + ביצוע. נכתב 26.7.2026.
> **קרא קודם את "מצב קיים — מה שמצאתי בפועל" ואת "מה שאני צריך ממך".**
> כל מה שכתוב כאן על סכימת הדאטהבייס מסומן במפורש כ**מאומת** (יש לו קובץ SQL בריפו) או כ**משוער** (שוחזר מקריאות/כתיבות בקוד). ראה §0.

---

## 0. אזהרה קריטית — הסכימה האמיתית לא נמצאת בריפו

אין בריפו `CREATE TABLE` לאף אחת מהטבלאות המרכזיות: `leads`, `customers`, `sales_tasks`,
`orders`, `quotes`, `sync_progress`. הן נוצרו בתקופת base44, לפני שתיקיית המיגרציות הוקמה.

בנוסף — **27 מתוך 58 קבצי המיגרציה בריפו אין להם GitHub Action משויך**, והגבול הוא בדיוק
`20260529000001_service_center.sql`. כלומר *כל* המיגרציות שנוגעות ללידים/לקוחות נמצאות בצד
הלא-מחווט: `website_leads_rpc`, `normalize_lead_statuses`, `backfill_customers_from_closed_leads`,
`customers_stats_view`, `phone_trigram_indexes`, `add_support_tickets_customer_lead_fk`,
`lead_activity_log_*`, `drop_customers_vip_status`. מנגנון ה-`*-migrate.yml` נוצר רק ב-25.6.2026,
אחרי כולן. הן הורצו ידנית ב-SQL Editor — ואין שום רישום בריפו האם ההרצה הצליחה.

**המשמעות המעשית:** אני לא יכול לדעת בוודאות אילו עמודות, מפתחות זרים, אינדקסים, טריגרים
ומדיניות RLS קיימים היום בפרודקשן. במיוחד לא ידוע:

- האם ל-`quotes.lead_id`, `orders.lead_id`, `call_logs.lead_id`, `communication_logs.lead_id`
  יש FK בכלל. אם base44 יצר אותם עם ברירת המחדל (`NO ACTION`), **`DELETE FROM leads` ייכשל
  לחלוטין** במקום לייתם שורות.
- האם `lead_activity_logs` ו-ה-`ON DELETE CASCADE` שלו קיימים (אם כן — כל ההיסטוריה נמחקת עם הלידים).
- האם `customers.vip_status` נמחקה בפועל, והאם `customers.status` בכלל קיימת בסכימה
  (הקוד כותב אליה פעם אחת את הערך `'active'`, ו-`writeWithSchemaResilience` ב-`src/api/entities.js:65-79`
  *משמיט בשקט* עמודות שלא קיימות — כך שייתכן שהיא נזרקת בכל שמירה).
- אילו GRANTs יש ל-`anon`/`authenticated` על `leads`/`customers`/`sales_tasks` — אין אף
  `GRANT` על טבלאות באף מיגרציה.

**לכן §1 (הפעולות שלך) חוסם את כל השאר.** בלי dump אמיתי, כל מיגרציה שאכתוב היא ניחוש.

---

## 1. מה שאני צריך ממך — לפני שאני כותב שורת קוד אחת

### 1.1 Dump של הסכימה (חובה, חוסם)
הכנתי סקריפט אחד: **`scripts/inspect-production-schema.sql`**.
לך ל-Supabase → SQL Editor → הדבק → Run → העתק לי את הפלט המלא.
הוא **קריאה בלבד** — לא משנה שום דבר. הוא מחזיר:
עמודות, טיפוסים, מפתחות זרים + התנהגות ON DELETE, אינדקסים, טריגרים, מדיניות RLS, GRANTs,
וגם ספירות אמת: כמה פורמטי טלפון שונים יש, כמה כפילויות טלפון, אילו ערכי `source` קיימים בפועל,
ואילו ערכי `status` קיימים בפועל.

### 1.2 גיבוי (חובה, חוסם)
- ודא ב-Supabase → Settings → Database שיש **PITR** או לפחות גיבוי יומי פעיל, ואמור לי מה יש.
  `docs/improvement-plan.md:208` מציין את זה כ-TODO **שלא אומת מעולם**. מיגרציות אינן הפיכות.
- לפני האיפוס אבצע גם גיבוי מפורש לטבלאות `leads_archive_2026` / `sales_tasks_archive_2026`
  בתוך אותו DB (זול, מיידי, ומאפשר לשחזר בלי לגעת ב-PITR).

### 1.3 קובץ הייבוא (חוסם את שלב 6)
שלח לי **דוגמה של 50 שורות** מקובץ הייבוא (CSV/Excel) עם השורה של הכותרות.
אני צריך לראות: אילו עמודות יש, איך נראים הטלפונים, איך נראים התאריכים, איך נראים המקורות,
ואיך נראים הסטטוסים. בלי זה אי אפשר לכתוב את המיפוי.
בנוסף: **כמה קבצים** ומה גודלם, והאם הם מייצאים גם משימות מכירה או רק לידים.

### 1.4 האוטומציות ב-Supabase Dashboard (חוסם את שלב 6)
`createSalesTaskForNewLead`, `trackLeadAssignment`, `updateLeadCounterOnChange`, `updateTaskCounters`
מופעלות ע"י Database Webhooks **שמוגדרים בדשבורד ולא בריפו**. שלח לי צילום מסך של
Database → Webhooks כדי שאדע מה בדיוק צריך לכבות בזמן הייבוא.
בייבוא של 50k שורות הן ירוצו 50,000 פעם — כלומר 50k משימות שיוך, 50k התראות ו-50k פושים.

### 1.5 סביבת חזרה
היום יש **פרויקט Supabase אחד בלבד**, ו-`deploy-functions.yml` + מיגרציות רצים גם מברנצ'ים
של `claude/*` — כלומר **ה-preview כותב לפרודקשן** (`docs/improvement-plan.md` E6, סעיף פתוח).
האם להקים פרויקט Supabase נפרד ל-staging לצורך חזרה גנרלית על האיפוס+ייבוא?
**המלצה: כן.** זה מהלך הרסני על 104k רשומות, ואין בריפו אף בדיקה אוטומטית (`improvement-plan` E4).
עלות: כמה שעות עבודה + פרויקט Supabase נוסף.

---

## 2. מצב קיים — מה שמצאתי בפועל

### 2.1 טלפונים — הבעיה שתיארת, מאומתת
- **`src/utils/phoneUtils.js` כבר קיים** ומכיל `normalizeIsraeliPhone()` שמייצר `972XXXXXXXXX`.
  **אף נתיב כתיבה לא משתמש בו.** הוא משמש רק לתצוגה ולקישורי וואטסאפ.
- כל בדיקת כפילות במערכת היא **השוואת מחרוזת מדויקת**:
  - `src/pages/LeadDetails.jsx:309` — `Customer.filter({ phone: lead.phone })`
  - `supabase/functions/upsertLead/index.ts:66` — `.eq('phone', leadData.phone)`
  - `20260426000005_backfill_customers_from_closed_leads.sql:49` — `c.phone = l.phone`
  - `supabase/functions/importSalesTasksFromSheets/index.ts:79`
- לעומת זאת כל **חיפוש** משתמש ב-`ILIKE '%9 ספרות אחרונות%'`. כלומר: המערכת *מוצאת* כפילויות
  בחיפוש אבל *יוצרת* אותן בכתיבה. זה בדיוק המנגנון שמייצר כמה לקוחות לאותו מספר.
- הפורמטים שנמצאים היום במקביל: `0501234567`, `050-1234567`, `972501234567`,
  `972501234567@c.us` (וואטסאפ), ו-digits-only (מייבוא Sheets).
- **אין אף אילוץ UNIQUE** על `leads.phone` או `customers.phone`. שתי כתיבות מקבילות לאותו
  מספר שתיהן יצליחו.
- יש 6 פונקציות נרמול שונות בקוד שלא מסכימות ביניהן:
  `phoneUtils.normalizeIsraeliPhone` (→972), `serviceOptions.normalizePhone` (→0),
  `whatsappHelpers`, `useWhatsAppContext.phoneTail`, `GlobalSearch.normalizePhoneForSearch`,
  `SalesTaskDialog.normalizePhoneForLeadLookup`.

### 2.2 לקוחות — אין סטטוס, ויש שני נתיבי המרה סותרים
- `customers` היא טבלה משנת base44. ~15k שורות, מולאו ע"י גיבוב חד-פעמי מכל ליד ב-`deal_closed`.
- **אין בה עמודת סטטוס שנקראת ע"י משהו.** יש עמודה `status` שנכתב אליה פעם אחת הערך `'active'`
  ואף אחד לא קורא אותה (וייתכן שהיא לא קיימת בכלל — ראה §0).
- שני נתיבים סותרים להפוך ליד ללקוח:
  - כפתור "המר ללקוח" (`LeadDetails.jsx:306-347`) — **נכשל בשגיאה** אם הטלפון כבר קיים,
    ומעדכן את הליד לסטטוס **`'won'`** — ערך שלא קיים באף רשימת סטטוסים במערכת ולא נספר באף דוח.
  - `/NewOrder` (`NewOrder.jsx:343-372`) — מעדכן בשקט אם קיים, ומעדכן את הליד ל-`deal_closed`.
- `customers.lead_id` הוא מצביע **לליד אחד בלבד**. `/CustomerDetails` שולף הצעות מחיר רק דרכו
  (`CustomerDetails.jsx:62-66`), כך שלקוח עם כמה לידים רואה הצעות מליד אחד בלבד. **זו בדיוק
  הבעיה שאתה רוצה לפתור.**
- `customers.total_revenue` **אף פעם לא נכתב** ע"י שום קוד — הוא 0 בכל השורות. ובכל זאת
  הוא הבסיס ל-KPI "סה״כ הכנסות" ול-`customers_stats.revenue`. **המספר שאתה רואה היום במסך
  לקוחות הוא אפס משמעותי.** מה שכן מתעדכן זה `lifetime_value`.

### 2.3 מקורות — מפוזרים בין 5 מקומות
- `LEAD_SOURCE_OPTIONS` (`src/constants/leadOptions.js:50-57`) = **6 ערכים בלבד**:
  `store / callcenter / digital / whatsapp / referral / website`.
  **טיקטוק, אינסטגרם, יוטיוב ופייסבוק לא קיימים ברשימה הזו בכלל.**
- הם קבורים ב: `utm_source`, `facebook_platform`, `facebook_ad_name`, `landing_page`, `tags`.
- `leads.source` הוא **טקסט חופשי בלי CHECK** — `importLeadsFromGoogleSheets` כותב לתוכו את
  עמודה 2 מהגיליון כמו שהיא, ו-`upsertLead` מעביר כל payload.
- מקור "אתר" מסומן **בשלוש דרכים שיכולות לסתור**: `source='website'`, `tags @> ['אתר']`,
  ו-`source_form IS NOT NULL`.
- לוגיקת גזירת המקור מיושמת **4 פעמים בנפרד** עם סדרי עדיפויות שונים:
  `getDashboardStats/index.ts:56-78`, `dashboard_stats_v1` (SQL), `Marketing.jsx normSource`,
  ו-`SalesTaskDialog`. הן לא מסכימות.
- `club_signups` היא טבלה נפרדת לגמרי עם סטטוסים משלה שלא מחוברת ללידים.

### 2.4 סטטוסי ליד — שלוש אוצרות מילים מקבילות
- הדרופדאון באפליקציה: **27 ערכים** (`leadOptions.js:8-38`).
- המיגרציה `20260426000004_normalize_lead_statuses.sql`: **44 מפתחות** (כולל 22 שאף דרופדאון
  לא מציע — `service_*`, `delivery_inquiry*`, `will_arrive_for_meeting`, `second_line_lead`,
  `call_from_google`, `system_test`, `no_answer_8_calls`...).
- שני זוגות כפולים לאותה תווית עברית: `coming_to_branch` מול `will_arrive_for_meeting`,
  ו-`no_answer_calls` מול `no_answer_8_calls`.
- ערכים מחוץ לכל טקסונומיה שנכתבים ע"י קוד חי: **`'won'`** (LeadDetails), **`'qualified'`**
  (NewQuote), **`'new'`** (NewLead — אבל זה נדרס מיד ל-`new_lead`).
- **סטטוסים מותאמים אישית** נשמרים ב-**localStorage של הדפדפן** (`useCustomStatuses.js`)
  ונכתבים ל-DB כ-`custom_<slug>`. כלומר יש בפרודקשן ערכי סטטוס שאין להם שום הגדרה בשרת.
- הגדרת "סטטוס סגור" (`CLOSED_STATUSES`, 14 ערכים) **משוכפלת ב-4 מקומות**:
  `leadOptions.js:40-46`, `landing_pages_stats` view, `dashboard_stats_v1`, `getDashboardStats`.
- **חדשות טובות:** `LeadManagement.jsx:80-96` **כבר מחשב בדיוק את שלושת המצבים שביקשת** —
  `won = deal_closed`, `lost = 13 הסטטוסים הסגורים האחרים`, `open = כל השאר`. רק שזה ברמת
  הליד ולא ברמת האדם.

### 2.5 נתיבי יצירת ליד — 7 חיים, כל אחד מתנהג אחרת
| נתיב | קובץ | בדיקת כפילות |
|---|---|---|
| `/NewLead` | `src/pages/NewLead.jsx:60` | **אין בכלל** |
| `/NewQuote` (יוצר ליד אם אין) | `NewQuote.jsx:294` | ILIKE על 9 ספרות אחרונות |
| RPC ציבורי מהאתר | `20260415000005_website_leads_rpc.sql` | **אין בכלל** |
| `upsertLead` (webhook חיצוני) | `functions/upsertLead/index.ts:66` | `.eq` מדויק על טלפון |
| `importLeadsFromSheets` | `functions/importLeadsFromSheets` | `.eq` מדויק |
| `importLeadsFromGoogleSheets` | `functions/importLeadsFromGoogleSheets:158` | **אין בכלל** |
| `uploadLeads` | `functions/uploadLeads` | — (אין קורא ב-UI) |

`LeadBulkUpload.jsx` הוא **קוד מת** — אין לו אף הפניה בכל `src/`.
כך גם `CallLogger.jsx` ו-`AIInsights.jsx`.

### 2.6 רדיוס הפגיעה של מחיקה — מה שכן מאומת
- `lead_activity_logs` → `ON DELETE CASCADE` (`20260430000002:39`) — **נמחק כולו**.
- `support_tickets.lead_id` → `ON DELETE SET NULL` (`20260426000002:15`) — הקריאות שורדות אבל מתנתקות.
- `quotes.lead_id`, `orders.lead_id`, `call_logs.lead_id`, `communication_logs.lead_id`,
  `sales_tasks.lead_id`, `upsell_suggestions.lead_id` — **אין FK באף מיגרציה. מצבם בפרודקשן לא ידוע.**
- `lead_counters` — **אין אף פונקציה שמחשבת אותו מחדש**, רק webhook אינקרמנטלי
  (`updateLeadCounterOnChange`). אחרי איפוס הוא יישאר שגוי לנצח.
- `task_counters` — נבנה מחדש ע"י `updateTaskCounters` (collect→save).
- `dashboard_counters` — נבנה מחדש ע"י `updateDashboardCounters`, אבל דורש משתמש מחובר.

### 2.7 תשתית הייבוא — לא תעמוד ב-50k
- `importLeadsFromSheets` מושך `A:Z` של **כל הגיליון** מ-Google Sheets **בכל אצווה של 50 שורות**.
  ב-50k שורות זה 1,000 אצוות × משיכה של 50k שורות = ~50 מיליון שורות שנשלפות מיותר.
- הלולאה יושבת ב-**קומפוננטת React** (`ImportFromSheets.jsx:100-124`). כלום לא מתאושש
  אם הטאב נסגר. בקצב הנוכחי (~4.4 שורות/שנייה) ייבוא של 50k = **כ-3 שעות עם טאב פתוח**.
- `A:Z` = מקסימום 26 עמודות.
- `importLeadsFromGoogleSheets` לא עושה דה-דופליקציה **בכלל** ומקודד בקשיחות לגיליון אחד.
- `normalizeLeadStatuses` (שממלא לקוחות מלידים סגורים) **נכנס ללולאה אינסופית** כשיש 1000+
  לידים ב-`deal_closed` (`index.ts:183-242` — אין pagination), והוא **לא ברשימת הפריסה**
  ב-`deploy-functions.yml`.

### 2.8 מגבלות שישפיעו על העיצוב
- **`src/api/entities.js` לא יודע לעשות JOIN.** `filter(...)` מעביר את `columns` כמחרוזת שטוחה
  ל-`.select()`, ואין **אף** embedded-resource select בכל הריפו. כלומר: שדות של איש הקשר
  חייבים להיות **מדונרמלים על `leads`** או להיחשף דרך **VIEW** — אי אפשר פשוט לצרף טבלה.
- `PostgREST max_rows = 1000`. כל `list()`/`filter()` בלי דפדוף נחתך בשקט.
- `/Quotes` מושך את **כל 104k הלידים** לכל משתמש (כולל אדמין) רק כדי לבנות מפת הרשאות
  (`Quotes.jsx:52-58`) — עם השהיה יזומה של 150ms בין עמודים = ~31 שניות.
- `/LeadManagement` יורה כ-**`4N+23` שאילתות count** לכל טעינת דף (N = מספר נציגים).
- חיפוש ב-`/LeadManagement` מעביר טקסט **לא-מוברח** ל-PostgREST `.or()`. שם מיובא עם פסיק
  ישבור את השאילתה.
- שני מודולי RBAC סותרים פועלים במקביל: `components/shared/rbac.jsx` (הישן — משמש
  LeadManagement/LeadDetails/SalesTasks) מול `lib/rbac.js` (הקנוני — משמש Customers/Quotes/Orders).

---

## 3. הכרעות שכבר סגרנו

| # | נושא | ההכרעה |
|---|---|---|
| 1 | ישות איש הקשר | **מרחיבים את `customers`** — לא טבלה חדשה. כל הקישורים הקיימים נשמרים. |
| 2 | סטטוס לקוח | **נגזר אוטומטית** מהלידים + ההזמנות. |
| 3 | היקף המחיקה | לידים + משימות + לוגים נלווים. **מסחר (הצעות/הזמנות/לקוחות) נשמר.** |
| 4 | מנגנון ייבוא | **CSV → טבלת staging → מיזוג ב-SQL.** לא Google Sheets. |
| 5 | פורמט טלפון | **עמודה נפרדת `phone_normalized`** בפורמט `972XXXXXXXXX` + UNIQUE. `phone` נשאר כפי שהתקבל. |
| 6 | מבנה מקור | **דו-רבדי:** `source_channel` (רשימה סגורה) + `source_detail` (חופשי). ה-UTM נשמרים. |
| 7 | אותו טלפון, שם אחר | **איש קשר אחד**, עם `alt_names[]` שנשמרים וניתנים לחיפוש. |
| 8 | סטטוסי ליד | **נשארים כמו שהם (27).** רק מוסיפים טבלת מיפוי לסטטוס הלקוח. |

---

## 4. שאלות פתוחות — צריך את התשובות שלך

לכל שאלה יש **ברירת מחדל מומלצת**. אם אתה מסכים לכולן — תגיד "מאשר הכל" ואני ממשיך.

### 4.1 מתי איש קשר הוא "לקוח משלם"?
- **(א) יש לו הזמנה בפועל** ← *מומלץ.* עובדה קשיחה מהמערכת, לא תלויה בזה שנציג זכר לעדכן סטטוס.
- (ב) יש לו ליד ב-`deal_closed` (מה שקורה היום).
- (ג) יש לו הזמנה **ששולמה** (`payment_status`).

> אזכיר: `total_revenue` הוא 0 בכל השורות. בכל מקרה אחשב מחדש `lifetime_value` ו-`total_orders`
> מסכום ההזמנות בפועל — אחרת ה-KPI במסך לקוחות ימשיך להיות שקר.

### 4.2 רשימת סטטוסי הלקוח המדויקת
הצעה:

| מפתח | תווית | מתי |
|---|---|---|
| `new` | חדש | נוצר, אין עדיין ליד פעיל |
| `interested` | מתעניין | יש לפחות ליד אחד פתוח |
| `customer` | לקוח משלם | יש לפחות הזמנה אחת |
| `repeat_customer` | לקוח חוזר | 2+ הזמנות |
| `lost` | אבוד | כל הלידים נסגרו, אף אחד לא `deal_closed` |
| `do_not_contact` | הסרה מדיוור | ליד ב-`mailing_remove_request` או `closed_by_manager_to_mailing` |

**סדר עדיפויות:** `do_not_contact` > `customer`/`repeat_customer` > `interested` > `lost` > `new`.
כלומר לקוח משלם שפתח ליד חדש נשאר "לקוח משלם" — הליד הפתוח מוצג בנפרד בכרטיס.

**שאלה:** מאשר את הרשימה? רוצה תוויות אחרות? רוצה להוסיף/להוריד סטטוס?

### 4.3 רשימת ערוצי המקור המדויקת
הצעה ל-`source_channel`:

`facebook` פייסבוק · `instagram` אינסטגרם · `tiktok` טיקטוק · `google` גוגל ·
`youtube` יוטיוב · `website` אתר · `whatsapp` וואטסאפ · `store` חנות ·
`callcenter` מוקד · `referral` הפניה · `club` מועדון · `other` אחר

`source_detail` = טקסט חופשי: שם דף הנחיתה / שם הקמפיין.

**שאלות:**
- מאשר את הרשימה? חסר ערוץ (טאבולה? אאוטבריין? מייל? SMS? יריד/תערוכה?)
- הערכים הישנים `digital` ו-`callcenter` — `digital` הוא כללי מדי. למפות אותו ל-`other`
  ולתת ל-UTM להכריע, או להשאיר אותו כערוץ בפני עצמו?
- **דפי הנחיתה שלך** — תשלח לי את הרשימה (URL + שם ידידותי) כדי שאבנה את טבלת המיפוי.

### 4.4 מה עושים עם ההיסטוריה המסחרית שמצביעה על לידים שיימחקו?
- **(א) לקשר מחדש לאיש הקשר לפי טלפון** ← *מומלץ.* לפני המחיקה שומר את הטלפון של כל ליד
  על השורות התלויות; אחרי הייבוא ממלא `contact_id`. כרטיס הלקוח ממשיך להציג את כל ההיסטוריה.
- (ב) לנקות `lead_id` ל-NULL. מאבד את שיוך המכירה למקור השיווקי.
- (ג) כמו (א) + ארכיון מלא של `leads` ל-`leads_archive_2026`.

> **הערה שלי:** אני ממליץ על **(ג)** ולא על (א) — הארכיון עולה רק מקום בדיסק והוא רשת
> הביטחון הזולה ביותר כאן. ההצבעה שלך על (א) עדיין תקפה; רק תגיד אם אתה רוצה גם את הארכיון.

### 4.5 האוטומציות בזמן הייבוא
- **(א) ניתוק זמני בדשבורד** ← *מומלץ.* אני נותן הוראות מדויקות, אתה מכבה ומדליק.
  בנוסף מוסיף לטבלה עמודה `import_batch_id` שהטריגרים מדלגים עליה גם אם שוכחים.
- (ב) להעביר את כל הוובהוקים מהדשבורד למיגרציות בריפו (עבודה נוספת, אבל מסיים את המצב
  שבו לוגיקה קריטית חיה מחוץ לגיט).

### 4.6 טלפונים שלא ניתן לנרמל
מספרים זרים, מספרים חסרים, מספרים שבורים.
- **(א)** ליצור איש קשר עם `phone_normalized` = הספרות כמו שהן + לסמן `phone_valid = false`
  ולהציג מסך "לבדיקה" ← *מומלץ.*
- (ב) לדחות את השורה בייבוא ולהוציא דוח שגיאות.
- (ג) ליצור ליד בלי איש קשר בכלל.

### 4.7 שאלות קטנות יותר (אפשר לענות בשורה)
1. הליד בייבוא — **לשמור את הנציג המקורי** מהקובץ, או שהכל נכנס לא-משויך? (היום מדיניות
   המערכת היא "הכל לא-משויך", אבל בייבוא היסטורי זה כנראה לא מה שאתה רוצה)
2. **תאריכים** — לשמור את `created_date` המקורי מהקובץ? (מניח שכן — אחרת כל הדוחות ההיסטוריים מתים)
3. **22 הסטטוסים שאין להם דרופדאון** (`service_*`, `delivery_inquiry*`, `second_line_lead`,
   `call_from_google`...) — למחוק, למפות לקיימים, או להוסיף לדרופדאון?
4. **`coming_to_branch` מול `will_arrive_for_meeting`** ו-**`no_answer_calls` מול
   `no_answer_8_calls`** — איזה מהשניים נשאר בכל זוג?
5. **סטטוסים מותאמים אישית** ב-localStorage — להפוך לטבלה אמיתית ב-DB, או לבטל את הפיצ'ר?
6. **`club_signups`** — הנרשמים למועדון הופכים לאנשי קשר (יש להם טלפון+מייל), או נשארים רשימה נפרדת?
7. **חלון תחזוקה** — מתי אפשר לבצע את האיפוס? כמה שעות השבתה מקובלות?
8. **קוד מת** (`LeadBulkUpload`, `CallLogger`, `AIInsights`) — למחוק במסגרת המהלך? (ממליץ כן,
   זה מקטין את שטח הפגיעה)
9. **בדיקות אוטומטיות** — להקים חבילת Playwright מינימלית (5-7 תרחישים) לפני האיפוס?
   אין היום **אף** בדיקה בריפו, והמהלך נוגע ביצירת ליד, רשימת לידים, חיפוש, הצעה והזמנה.

---

## 5. העיצוב המוצע

### 5.1 טבלת `customers` (= אנשי קשר) — עמודות חדשות

```sql
phone_normalized  text        -- 972XXXXXXXXX, נכתב ע"י טריגר. UNIQUE (חלקי, WHERE NOT NULL)
phone_valid       boolean     -- false = לא ניתן לנרמל, מופיע במסך "לבדיקה"
alt_names         text[]      -- שמות נוספים שנראו על אותו מספר
alt_phones        text[]      -- מספרים נוספים של אותו אדם (מיזוג ידני)
contact_status    text        -- new/interested/customer/repeat_customer/lost/do_not_contact
status_updated_at timestamptz
first_seen_date   timestamptz -- תאריך הליד המוקדם ביותר
last_activity_date timestamptz
leads_count       integer     -- מדונרמל, מתוחזק בטריגר
open_leads_count  integer
orders_count      integer
source_channel    text        -- מקור המגע הראשון (first-touch)
source_detail     text
```

`customers.lead_id` נשאר לתאימות אחורה אבל **מפסיק להיות מקור האמת** — הוא יצביע על הליד
הראשון. `/CustomerDetails` יעבור לשלוף לפי `contact_id`.

### 5.2 טבלת `leads` — עמודות חדשות

```sql
contact_id        uuid REFERENCES customers(id) ON DELETE CASCADE   -- NOT NULL אחרי הייבוא
phone_normalized  text        -- מדונרמל מאיש הקשר, לחיפוש מהיר בלי JOIN
source_channel    text        -- הרשימה הסגורה
source_detail     text
import_batch_id   uuid        -- מזהה אצוות ייבוא; הטריגרים מדלגים על שורות עם ערך
```

**למה `phone_normalized` גם על הליד?** כי `src/api/entities.js` לא יודע לעשות JOIN (§2.8).
בלי הדנורמליזציה כל מסך רשימת לידים יצטרך שכתוב מלא.

### 5.3 נרמול טלפון — בצד ה-DB, לא בצד הקוד

```sql
CREATE FUNCTION public.normalize_il_phone(raw text) RETURNS text
-- 0501234567 / 050-1234567 / +972-50-1234567 / 972501234567@c.us  →  972501234567
```

טריגר `BEFORE INSERT OR UPDATE` על `customers` ועל `leads` ממלא את `phone_normalized`.
**זו הנקודה הקריטית:** ברגע שזה בצד ה-DB, **כל** 7 נתיבי הכניסה מכוסים אוטומטית — כולל
ה-RPC הציבורי מהאתר וה-webhook החיצוני, בלי לגעת בהם.

### 5.4 פתור-או-צור איש קשר — פונקציית DB אחת

```sql
CREATE FUNCTION public.resolve_or_create_contact(
  p_phone text, p_name text, p_email text, p_city text,
  p_source_channel text, p_source_detail text
) RETURNS uuid
```

- מנרמלת את הטלפון
- מחפשת ב-`customers.phone_normalized`
- אם קיים: מחזירה את ה-id, ומוסיפה את השם ל-`alt_names` אם הוא חדש
- אם לא: יוצרת איש קשר עם `contact_status='new'` ו-first-touch attribution
- **`INSERT ... ON CONFLICT (phone_normalized) DO UPDATE`** — עמיד למרוצי כתיבה

וטריגר `BEFORE INSERT ON leads` שקורא לה אוטומטית אם `contact_id IS NULL`.
שוב: **כל נתיב כניסה מכוסה בלי לשנות אותו.**

### 5.5 סטטוס לקוח נגזר

```sql
CREATE FUNCTION public.recompute_contact_status(p_contact_id uuid) RETURNS void
```
נקראת מטריגר `AFTER INSERT/UPDATE/DELETE` על `leads` ועל `orders`.
מקור אמת יחיד ל-`CLOSED_STATUSES` — **טבלת `lead_status_config`** במקום 4 העתקים בקוד:

```sql
CREATE TABLE public.lead_status_config (
  status_key text PRIMARY KEY,
  label_he   text NOT NULL,
  bucket     text NOT NULL CHECK (bucket IN ('open','won','lost')),
  sort_order integer
);
```

הפרונט טוען אותה במקום `leadOptions.js` (עם הקובץ כ-fallback).

### 5.6 מיפוי מקורות

```sql
CREATE TABLE public.source_mapping (
  pattern_type text,   -- 'utm_source' | 'landing_page' | 'legacy_source' | 'fb_platform'
  pattern      text,   -- הערך הגולמי או תבנית
  channel      text,   -- הערוץ הקנוני
  detail       text
);
```
טריגר על `leads` גוזר `source_channel`/`source_detail` בסדר עדיפויות:
`source_channel` מפורש → `facebook_platform` → `utm_source` → `landing_page` →
`tags` → `source` הישן → `other`.
**זה מחליף את 4 היישומים הכפולים.**

---

## 6. תוכנית הביצוע

| שלב | מה | הרסני? | תלוי ב |
|---|---|---|---|
| **0** | Dump סכימה, אימות גיבוי, קבלת קובץ דוגמה | לא | **אתה** (§1) |
| **0.5** | ניקוי מקדים: מחיקת קוד מת, תיקון `'won'`/`'qualified'`, הברחת חיפוש | לא | — |
| **1** | תשתית: `normalize_il_phone`, `phone_normalized` + טריגרים + UNIQUE, מיזוג הכפילויות הקיימות ב-`customers` | לא | 0 |
| **2** | `lead_status_config` + `source_mapping` + טריגר גזירת מקור | לא | 1 |
| **3** | `resolve_or_create_contact` + טריגר על `leads`. **מכאן כל ליד חדש מקבל איש קשר.** | לא | 1,2 |
| **4** | `recompute_contact_status` + טריגרים + backfill על הקיים | לא | 3 |
| **5** | UI: כרטיס לקוח עם כל הלידים · סטטוס לקוח במסך לקוחות + פילטר · איתור ליד מקובץ לפי אדם · ערוץ מקור בטבלאות ובדוחות | לא | 4 |
| **6** | **האיפוס והייבוא** — runbook ידני, לא מיגרציה | **כן** | 5 + אישור שלך |
| **7** | אחרי: בנייה מחדש של מונים, שאילתות אימות, הפעלת אוטומציות | לא | 6 |

**חשוב:** שלבים 1-5 הם **לא הרסניים ולא שוברים כלום**. הם רצים על 104k הלידים הקיימים
ומשפרים אותם *לפני* האיפוס. אם מסיבה כלשהי תחליט לא לאפס — הרווחת את כל המודל החדש בכל מקרה.

### 6.1 למה האיפוס לא יהיה מיגרציה
מנגנון המיגרציות כאן הוא **workflow אחד לכל קובץ SQL**, בלי `needs:`, בלי `concurrency:`,
בלי ledger של גרסאות. מיזוג שנוגע ב-N קבצים מפעיל N ג'ובים **במקביל בלי סדר מובטח**.
מהלך רב-שלבי הרסני לא יכול לרוץ ככה.
לכן: שלבים 1-5 = מיגרציות רגילות (אידמפוטנטיות, workflow לכל אחת).
שלב 6 = **runbook** שאתה ואני מריצים ידנית ב-SQL Editor, שלב-אחר-שלב, עם בדיקת אימות בין כל שלב.

### 6.2 ה-runbook של שלב 6 (טיוטה)
```
1.  כיבוי Database Webhooks בדשבורד
2.  CREATE TABLE leads_archive_2026 AS SELECT * FROM leads;   (+ sales_tasks)
3.  שמירת מיפוי lead_id → phone_normalized על quotes/orders/tickets/call_logs
4.  ALTER TABLE leads DISABLE TRIGGER USER;
5.  DELETE FROM sales_tasks;  DELETE FROM leads;   ← מכאן חוזרים רק מגיבוי
6.  TRUNCATE lead_counters, task_counters;
7.  יצירת import_leads_staging (כל העמודות text)
8.  העלאת ה-CSV → staging   (Supabase Table Editor / \copy)
9.  אימות: ספירות, שורות בעייתיות, טלפונים שלא מתנרמלים  ← עוצרים ובודקים
10. UPSERT אנשי קשר מה-staging (מקובצים לפי phone_normalized)
11. INSERT לידים מה-staging + contact_id + source_channel
12. קישור מחדש של quotes/orders/tickets לפי המיפוי מ-(3)
13. ALTER TABLE leads ENABLE TRIGGER USER;
14. recompute_contact_status על כל אנשי הקשר
15. בנייה מחדש של מונים
16. אימות סופי  ← אם משהו לא תואם, משחזרים מ-(2)
17. הפעלת Webhooks מחדש
```
**זמן משוער:** 15-30 דקות לביצוע. השלב האיטי היחיד הוא העלאת ה-CSV.
זה במקום ~3 שעות עם טאב פתוח בשיטה הנוכחית.

### 6.3 מה עוד ייגע — עדכונים נדרשים בקוד
- **`website_create_lead`** (ה-RPC הציבורי מהאתר) — הטריגר מכסה אותו אוטומטית, אבל צריך
  לוודא שהרג'קס `^0\d{1,2}[-]?\d{6,8}$` לא דוחה מספרים תקינים.
- **`upsertLead`** — לעבור מ-`.eq('phone', ...)` ל-חיפוש לפי `phone_normalized`.
- **`deploy-functions.yml`** — רשימת 42 הפונקציות היא ידנית וכבר **סטתה**.
  כל פונקציה חדשה חייבת להתווסף אליה אחרת היא לא נפרסת בשקט.
- **`normalizeLeadStatuses`** — יש בו באג לולאה אינסופית והוא לא ברשימת הפריסה.
  **המלצה: להוציא אותו משימוש** — הפונקציונליות שלו מוחלפת ע"י הטריגרים החדשים.

---

## 7. מה שאני ממליץ לעשות עכשיו — לפי הסדר

1. **הרץ את `scripts/inspect-production-schema.sql`** ושלח לי את הפלט. (חוסם הכל)
2. **אמת שיש PITR/גיבוי** ותגיד לי מה יש. (חוסם את שלב 6)
3. **שלח לי 50 שורות דוגמה** מקובץ הייבוא + רשימת דפי הנחיתה. (חוסם את שלבים 2 ו-6)
4. **צילום מסך של Database → Webhooks.** (חוסם את שלב 6)
5. **ענה על §4** — או תגיד "מאשר הכל" אם ברירות המחדל מקובלות.
6. **החלט על staging** (§1.5).

ברגע שיש לי (1) ו-(5) אני מתחיל לכתוב את שלבים 0.5 → 5. הם לא הרסניים ולא צריכים לחכות
לקובץ הייבוא.
