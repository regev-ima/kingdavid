# תוכנית עבודה — ביצועים, יציבות ואבטחה (יולי 2026)

> מסמך ביצוע. כל סעיף עומד בפני עצמו: רקע קצר, קבצים מדויקים, מה לעשות, ואיך לאמת.
> **לפני הכל קרא את "הקשר למבצֵע" ואת "כללי עבודה".** סדר הביצוע המומלץ — בסוף המסמך.

---

## הקשר למבצֵע (חובה לקרוא)

- **ריפו:** regev-ima/kingdavid · **ברנץ' עבודה:** `claude/keen-johnson-a46i71` · **PR פתוח:** #276 (דראפט, מכיל עבודה רבה שטרם מוזגה).
- **סטאק:** React + Vite, Supabase (PostgREST) דרך עטיפת base44 (`src/api/entities.js`, TABLE_MAP), react-query, RTL עברית, shadcn/ui.
- **מיגרציות DB** רצות **רק במיזוג ל-main** דרך GitHub Actions (תבנית `*-migrate.yml`: קריאת Management API עם `jq -Rs '{query:.}'` על קובץ המיגרציה, path-filtered). מיגרציה חדשה = קובץ SQL אידמפוטנטי + workflow תואם.
- **פונקציות Edge** נפרסות רק במיזוג (`deploy-functions.yml`, רשימה קשיחה של פונקציות — שים לב לסחף: יש פונקציות בתיקייה שאינן ברשימה). Preview של Vercel מדבר עם ה-DB והפונקציות של **פרודקשן**.
- **תקרת PostgREST:** `max_rows=1000` (supabase/config.toml). כל `.list()`/`.filter()` בלי דפדוף מוגבל בשקט ל-1000 שורות — זה שורש חלק גדול מבאגי הספירה.
- **RLS admin-check תקני** (בכל policy חדש): `EXISTS (SELECT 1 FROM public.users u WHERE (u.auth_id = auth.uid() OR u.email = (auth.jwt() ->> 'email')) AND u.role = 'admin')`.
- **בעברית למשתמש, אנגלית בקוד.** קומיטים בעברית (כמקובל בריפו). אין לכלול מזהי מודל בקומיטים/קוד.

## כללי עבודה

1. אחרי כל שינוי: `npx eslint <קבצים>` (אפס errors) + `npm run build` (exit 0).
2. שינוי ששובר התנהגות קיימת — לעצור ולתעד בהערת קומיט מה השתנה ולמה.
3. כל מיגרציה: `IF NOT EXISTS`/`DROP POLICY IF EXISTS` (אידמפוטנטית), `NOTIFY pgrst, 'reload schema'` בסוף, ו-workflow תואם.
4. לא למחוק קוד "כפול" לפני שממזגים את ההבדלים ההתנהגותיים שלו (ראה C2 — יש סטיות מכוונות).
5. עדיפות לשמירה על מבנה/סגנון קיים; אין ריפקטורים רוחביים מעבר למוגדר כאן.

---

# חלק A — ביצועים ("מהירות האור")

### A1. מיגרציית אינדקסים חסרים — P0, הרווח הגדול ביותר ביחס לסיכון
כל ספירות מרכז השליטה והשיווק רצות היום כ-seq scan. ליצור מיגרציה `supabase/migrations/2026070800000?_performance_indexes_2.sql` + workflow, עם:
```sql
CREATE INDEX IF NOT EXISTS idx_orders_payment_status    ON public.orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_production_status ON public.orders (production_status);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_status   ON public.orders (delivery_status);
CREATE INDEX IF NOT EXISTS idx_tickets_status           ON public.support_tickets (status);
CREATE INDEX IF NOT EXISTS idx_tickets_status_priority  ON public.support_tickets (status, priority);
CREATE INDEX IF NOT EXISTS idx_tickets_status_sla       ON public.support_tickets (status, sla_due_date);
CREATE INDEX IF NOT EXISTS idx_sales_tasks_created      ON public.sales_tasks (created_date);
CREATE INDEX IF NOT EXISTS idx_sales_tasks_open_status  ON public.sales_tasks (task_status, status);
CREATE INDEX IF NOT EXISTS idx_quotes_status            ON public.quotes (status);
CREATE INDEX IF NOT EXISTS idx_shipments_status         ON public.delivery_shipments (status);
```
ראיות: `useDashboard2Data.js:99-108,164-168`, `TeamTab.jsx:447`, `getDashboardStats/index.ts:197`, `SalesTasks.jsx` (סינון `.eq('status',…)` על משימות פתוחות).
**אימות:** אחרי מיזוג — ה-workflow ירוק; מרכז השליטה נטען מורגש מהר יותר.

### A2. איחוד 10 ספירות ה-live של מרכז השליטה ל-RPC אחד — P0
`useDashboard2Data.js:82-124` (`fetchLiveSnapshot`) יורה **10 בקשות count** במקביל (מול תקרת 6 חיבורים של הדפדפן). ליצור RPC `dashboard_live_v1()` (מיגרציה + GRANT ל-authenticated, בסגנון `dashboard_stats_v1` שב-`20260615000001_dashboard_stats_fn.sql`) שמחזיר את כל עשרת המונים בשורה אחת, ולהחליף את ה-Promise.all בקריאת `base44.supabase.rpc` אחת. פולבק: אם ה-RPC נכשל — הקוד הקיים (להשאיר כ-fallback).
**אימות:** טאב Network — בקשה אחת במקום 10; המספרים זהים לקודמים.

### A3. ביטול מפל-האימות של מרכז השליטה — P0
`Dashboard2.jsx:77-126`: הדף מריץ `base44.auth.me()` משלו ורק אז מדליק את כל השאילתות (`liveEnabled`). זו הרזולוציה **השלישית** של פרופיל המשתמש בטעינה (AuthContext + Layout כבר עשו). להחליף ל-`useQuery(['currentUser'])` המשותף (כמו Layout:144) או ל-hook `useEffectiveCurrentUser`, כך שהנתונים מתחילים להיטען מיד.
**אימות:** אין קריאת auth.me כפולה ב-Network; הדשבורד מתחיל לטעון נתונים מוקדם יותר.

### A4. לוודא ש-`dashboard_stats_v1` פרוס בפרודקשן — P0 (בדיקה, לא קוד)
אם ה-RPC חסר, כל טעינת דשבורד/שיווק נופלת ל-fallback שסורק טבלאות שלמות ב-JS (`getDashboardStats/index.ts:271-321`). לבדוק: קריאה ידנית ל-RPC, או להסתכל אם `failures` שמוחזר מהפונקציה כולל `dashboardStatsRpc`. אם חסר — להריץ מחדש את workflow המיגרציה `dashboard-stats-migrate.yml` (workflow_dispatch).

### A5. טעינה עצלה של טאבי מרכז השליטה — P1
`Dashboard2.jsx:13-19`: כל 8 הטאבים (כולל recharts) מיובאים סטטית → הכל ב-chunk הראשוני. להמיר את הטאבים שאינם ברירת-מחדל (Leads/Orders/Team/Marketing/…) ל-`React.lazy` + `Suspense` (להשאיר את OverviewTab eager). זה מוציא את recharts מהנתיב הקריטי.
**אימות:** `npm run build` — גודל ה-chunk של Dashboard2 יורד משמעותית.

### A6. TeamTab — ביטול השוואת-תקופה כברירת מחדל — P1
`TeamTab.jsx:380` (`compareEnabled` דיפולט true) גורם ל-2 קריאות `getDashboardStats` + 2 סריקות sales_tasks בכל פתיחת הטאב. לשנות דיפולט ל-false (טוגל ידני קיים).

### A7. `LeadsByStatusTable` — ספירה בשרת — P1
`LeadsByStatusTable.jsx:30-41` מושך `select('status')` על כל הלידים (נחתך ב-1000 → גם כבד וגם שגוי). להחליף ב-RPC `lead_status_counts()` (`SELECT status, count(*) FROM leads GROUP BY status`) או בסדרת head-counts לפי הסטטוסים המוצגים.

### A8. משיכות-טבלה-מלאה בדפים חמים — P1 (לפי סדר חשיבות)
להחליף משיכה מלאה בסינון/דפדוף/אגרגציה בשרת:
1. `Representatives.jsx:111-134` — 4 טבלאות מלאות (leads/quotes/customers/orders `select *`) שנטענות לצורך ספירות לנציג. להמיר ל-head-counts לכל נציג (כמו שכבר עשינו ב-LeadManagement workload) — זה גם מתקן את התנגשות ‎['leads']‎ (C1b).
2. `FactoryDashboard.jsx:60-83` — 5 `fetchAllList` מלאים בכל טעינה. לסנן בשרת (הזמנות פתוחות בלבד, מלאי מתחת לסף וכו').
3. `Orders.jsx:126`, `Finance.jsx:70-90`, `Deliveries.jsx:79-87`, `Customers.jsx:142-148`, `Quotes.jsx:46-55`, `Returns.jsx:57`, `ServiceCenter.jsx:56`, `PendingQuotesCard.jsx:22` — להוסיף limit+עמודות מצומצמות+דפדוף (או לפחות `columns` צר במקום `select *` — ב-quotes/orders ה-jsonb של items הוא רוב המשקל).
**הערה:** כל שינוי כזה חייב לשמר את ההתנהגות הנראית (סינון/מיון קיימים).

### A9. פולינג הקוביות במשימות מכירה — P1
`SalesTasks.jsx` (שאילתת `salesTasks-open-cube-rows`): מדפדף עד 30k שורות כל 60 שניות כשהמסך פתוח. להמיר את ספירות הקוביות ל-RPC אחד (`SELECT count(DISTINCT lead_id) FILTER (…)…`) או להעלות את ה-interval ל-5 דקות + refetchOnWindowFocus.

### A10. הקטנת ההשהיה המלאכותית בדפדוף — P2
`src/lib/base44Pagination.js:2` — ‎150ms בין כל עמוד (על 104k לידים ≈ 31 שניות של השהיה יזומה!). להוריד ל-0 ולהוסיף backoff רק על 429 בפועל.

### A11. שאר סעיפי P2
- `AIInsights.jsx:69-149` — נתיב האדמין מושך את כל ה-DB; להעביר לאגרגציה בשרת או לתחום בטווח תאריכים.
- `NotificationBell` — ה-subscribe הוא no-op (`entities.js` subscribe ריק) — או לממש Supabase Realtime או להסיר; לצמצם `select *` לעמודות נחוצות.
- `resolveUserProfile` — עד 2 שאילתות סדרתיות; לצמצם כפילויות רזולוציה (קשור ל-A3).
- `deploy-functions.yml` — ליישר את רשימת הפונקציות מול התיקייה (סחף: geocodeShipment, normalizeLeadStatuses, updateLeadCounterOnChange ועוד אינן ברשימה).
- VoiceCenter SDK (`Layout.jsx:177-193`) — נטען בכל דף; לדחות לטעינה בעת שימוש בטלפוניה.
- שיווק: טאב "דוח לידים" כבר תוקן (עמוד אחד); `enabled: isAdmin` עדיין ממתין ל-auth — לשקול אותה התרופה כמו A3.

---

# חלק B — אבטחה (חלקו קריטי — דורש החלטות מוצר, ראה "שאלות פתוחות")

### B1. אין RLS אמיתי על טבלאות הליבה — **הוכרע (7.7)**
`leads / orders / quotes / customers / sales_tasks` — אין להן ENABLE RLS; 32 טבלאות נוספות (`20240202000001_enable_rls_all_tables.sql`) עם `USING (true)`.
**הכרעת בעלים:** מודל "קריאה פתוחה" מקובל בכתב — נציג רשאי *לקרוא* כל ליד (זה מכוון: לקוח נכנס לחנות והנציג האחראי לא נמצא → הנציג מאתר את הליד ב"איתור ליד" וממשיך את הטיפול). ה-UI ממשיך להציג לכל נציג רק את שלו כברירת מחדל.
**מה נותר לבצע:**
1. לנעול **כתיבה** אדמין-בלבד בטבלאות הרגישות: `commissions`, `audit_logs`, `marketing_costs` (policy בתבנית התקנית). קריאה — כמצב הקיים.
2. **לא** מיישמים RLS קריאה פר-נציג על leads/orders/quotes/customers — הוחלט במפורש שלא.

### B2. הסלמת הרשאות עצמית — HIGH, תיקון מיידי וקטן
הטריגר ב-`20260517000002_users_privilege_escalation_lockdown.sql` חוסם שינוי `role/commission_rate/is_active/department/email/auth_id` — אבל **לא** את `extra_permissions` ו-`can_manage_service`. נציג יכול לעדכן לעצמו את כל ההרשאות הנתינות (view_finance, bulk_update, manage_service, edit_schedule). **מיגרציה:** להוסיף את שני השדות לרשימת החסימה בטריגר.

### B3. `getVoicecenterCredentials` מדליף סיסמת מאסטר — HIGH — **הוכרע (7.7)**
`supabase/functions/getVoicecenterCredentials/index.ts:11-21` מחזיר את `VOICENTER_MASTER_USERNAME/PASSWORD` לכל משתמש מחובר.
**הכרעת בעלים:** לכל נציג יש קוד שלוחה משלו. לתקן כך שהפונקציה מחזירה רק את פרטי **השלוחה של הנציג הקורא** (לפי הפרופיל שלו ב-users), לעולם לא את סיסמת המאסטר. אם ה-SDK מחייב אישורי מאסטר — לפרוקסות את הפעולה בפונקציית Edge (המאסטר נשאר בשרת בלבד). לבדוק מה `VoiceCenterCallPopup`/`clickToCall` באמת צריכים לפני השינוי.

### B4. `importProductsFromSheets` ללא בדיקת הרשאה — MEDIUM
מייבא getUser אך לא קורא לו. להוסיף בדיקת אדמין (כמו `importUsersFromSheets:9`).

### B5. משטחי עלות/שימוש-לרעה — **הוכרע (7.7): בלי הגבלות**
הכרעת בעלים: אין להגביל שליחת SMS/מייל לנציגים (ללא rate-limit). נשאר רק: `exportDashboardCsv` — לשקול גידור אדמין (ייצוא נתונים רוחבי), בעדיפות נמוכה.

### B6. מיגרציה שבורה לשחזור סביבה — MEDIUM
`20240202000001_enable_rls_all_tables.sql:51-54` משתמש ב-`CREATE POLICY IF NOT EXISTS` — תחביר לא חוקי בפוסטגרס; `db reset`/סביבה חדשה ייכשלו. לתקן ל-`DROP POLICY IF EXISTS` + `CREATE POLICY` (המיגרציה כבר רצה בפרוד — התיקון הוא לרפרודוסביליות בלבד).

### B7. התחזות (impersonation) — לתעד בלבד
צד-לקוח בלבד (localStorage); `getEffectiveUser` לעולם לא מרים ל-admin — אין הסלמה דרך זה. הסיכון האמיתי הוא B1 (כי השאילתות רצות בהרשאות המשתמש האמיתי בין כה וכה). אין פעולה מעבר ל-B1.

---

# חלק C — יציבות והתנגשויות

### C1. התנגשויות queryKey (אותו מפתח, fetch שונה → cache poisoning)
דפוס: `fetchAllList` (הכל) מול `.list()` (נחתך ב-1000) תחת אותו מפתח — מי שרץ ראשון קובע, והשני מציג נתונים חתוכים/שגויים בלי שגיאה.
1. **`['orders']` — HIGH:** FactoryDashboard:60 + OperationalReports:28 (מלא) מול Orders:124 / Finance:70 / Deliveries:83 (חתוך). פתרון: מפתח נפרד `['orders','all']` לצרכני-הכל, או fetch אחיד. לעדכן גם את כל ה-invalidations (LeadDetails:1452, Bookkeeping:90, FactoryKanban:169, FactoryCalendarBoard:200, OrderQuickView:43, SmartScheduler, CreationModalContext:55, ImportOrders:103 — invalidate לשני המפתחות).
2. **`['leads']` — MEDIUM:** SalesDashboard:227 (מלא) מול Representatives:111 (חתוך).
3. **`['returns']`, `['inventory']` — MEDIUM:** אותו דפוס (FactoryDashboard מלא מול Finance/Returns/Factory/Inventory חתוך).
4. **`['shipment', id]` — MEDIUM:** OrderDetails:107 לפי orderId מול ShipmentDetails:50 לפי shipmentId — לנמנס `['shipment-by-order', orderId]`.
5. **kebab מול camel — MEDIUM (מחירים!):** `['product-addons']`/`['product-addon-prices']` (בוני הצעות/הזמנות) מול `['productAddons']`/`['productAddonPrices']` (מסכי ניהול מוצרים). עדכון מחיר תוספת בניהול לא מרענן את הבונים → מחירים ישנים בהצעה. לאחד לכתיב kebab בכל הריפו + לעדכן invalidations.
6. **`['tickets']` מול `['service-tickets']`:** דיאלוגי שירות מנבלים `['tickets']` אבל ServiceCenter קורא `['service-tickets']` (ServiceCenter:55) — רענון לא מגיע. ליישר.

### C2. מודולים כפולים שסוטים זה מזה — HIGH
1. **rbac:** `src/lib/rbac.js` (קנוני) מול `src/components/shared/rbac.jsx` (ישן). מייבאים את הישן: LeadManagement, SalesTasks, LeadDetails, SalesDashboard, SalesTaskDialog. סטיות: `canManageService` בישן לא מכבד extra_permissions; `filterSalesTasksForUser` בישן מסנן משימות שיוך לנציגים ומתאים created_by (הקנוני לא!); `filterLeadsForUser` בישן מתאים created_by. **סדר פעולה מחייב:** קודם למזג את התנהגות הסינון (הסרת assignment-tasks לנציגים + created_by) לתוך `lib/rbac.js`, ורק אז להסב את 5 המייבאים ולמחוק את הישן.
2. **salesTaskWorkbench:** `src/lib/…js` (קנוני) מול `src/components/shared/…jsx`. `SalesTasks.jsx` מייבא **משניהם** (שורות 62-63)! סטיות: `normalizeTaskStatus` (טיפול ב-'new'/'waiting'/'resolved' שונה → אי-התאמות ספירה), `compareSalesTasks`, צורת החזרה של `getTaskCounterMismatches`, סקאלת עדיפויות. למזג ל-lib ולהסב את SalesTasks + SalesDashboard.
3. **useEffectiveCurrentUser:** `src/hooks/use-effective-current-user.jsx` (קנוני) מול `src/components/shared/useEffectiveCurrentUser.jsx`. להסב 3 מייבאים (`rawUser`→`user`).

### C3. עמוד `SalesDashboard` ישן — **הוכרע (7.7): למחוק**
למחוק את `src/pages/SalesDashboard.jsx` (נרשם אוטומטית ב-pageRoutes ומשתמש במודולים הישנים של C2). לוודא שאין ניווטים אליו (grep `SalesDashboard`) ולעדכן redirect אם קיים.

### C4. ניקיונות
- למחוק `src/pages.config.js` (מת; אם ייובא בטעות — מנפח bundle).
- אזהרות lint ותיקות (unused vars ב-SalesTasks/QuoteDetails/EditQuote/UpsellPanel/Layout) — לנקות.

### C5. השלמת אחידות הצעה/הזמנה — עבודה מתוכננת (שלב ב׳ שאושר)
`ProductItemsEditor` (טבלת פריטים + אשף-בהוספה) חובר ל-NewQuote בלבד. להשלים:
1. **NewOrder.jsx** — להחליף את שלב הפריטים ב-ProductItemsEditor (שים לב: מודל התוספות שם שונה — selected_addons מוטמע בשורה במקום שורות נפרדות; ליישר למודל ההצעה כולל השלכות על חישוב totals ותצוגת PDF הזמנה).
2. **EditQuote.jsx** — אותה החלפה (כולל טעינת items קיימים לעורך).
3. להרחיב גם את `NewOrderDialog` ל-max-w-[1100px] (כמו NewQuoteDialog).
**אימות:** יצירת הצעה/הזמנה/עריכת הצעה עם מיטה+תצורה+תוספות+הנחות — סכומים זהים בין המסכים, PDF תקין.

### C6. תלויות-מיזוג פתוחות (לוודא אחרי מיזוג #276)
מיגרציות שממתינות: bed options (003), addon-link (004), notes+key-backfill (005), leads effective_sort_date backfill (0707-1), lead_arrivals_by_shift (0707-2), quotes.special_requests (0707-3). אחרי מיזוג לוודא שכל ה-workflows ירוקים ולבדוק: שמירת special_requests, פיצול יום/לילה בקוביית הלידים, קישור תוספת+הערות בתצורת מיטות.

---

# סדר ביצוע מומלץ

| שלב | סעיפים | הערות |
|---|---|---|
| 1 | B2, B3, B4 | תיקוני אבטחה קטנים ומיידיים (מיגרציה + 2 פונקציות) |
| 2 | A1, A2, A3, A4 | ליבת הביצועים של מרכז השליטה/שיווק |
| 3 | C1 (כל ההתנגשויות), C2 (בזהירות, לפי הסדר המחייב) | נכונות נתונים |
| 4 | A5–A9 | ביצועים המשך |
| 5 | C5 | אחידות הצעה/הזמנה (שלב ב׳) |
| 6 | B1 (אחרי החלטה), B5, B6 | RLS מדורג + הקשחות |
| 7 | A10–A11, C3, C4 | ניקיונות ושיפורים משניים |

לאחר כל שלב: lint + build + push ל-`claude/keen-johnson-a46i71` (PR #276) + בדיקה ב-preview. מיגרציות/פונקציות — תוקף רק במיזוג.

---

# הכרעות בעלים (7.7.26) — סגורות

1. **B1:** קריאה פתוחה לכל נציג מקובלת (שירות לקוח נכנס דרך "איתור ליד"); ה-UI ממשיך להציג לכל נציג רק את שלו. נועלים רק כתיבה בטבלאות רגישות.
2. **C3:** SalesDashboard — נמחק.
3. **B3:** לכל נציג קוד שלוחה משלו — הפונקציה תחזיר רק את פרטי השלוחה של הקורא; המאסטר נשאר בשרת.
4. **B5:** ללא הגבלות שליחה.
