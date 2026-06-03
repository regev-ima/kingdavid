# מרכז שירות (Service Center)

אזור חדש לניהול פניות שירות לקוחות, שנבנה **מעל** טבלת `support_tickets` הקיימת
(לפי ההחלטה: להרחיב, לא לפצל) — בלי לגעת באזור "שירות לקוחות" / `/Support`
הקיים. הכל אדיטיבי, כך שהמסכים הישנים ממשיכים לעבוד.

## ההחלטות שננעלו

| נושא | הבחירה |
|------|--------|
| שליחת SMS | אינטגרציית **019** (שלב ראשון) + נפילה רכה לקישור/וואטסאפ |
| מודל נתונים | הרחבת `support_tickets` (אותו backend, אזור UI חדש) |
| הרשאות | הרשאה ייעודית `users.can_manage_service` הניתנת להענקה (אדמין מקבל אוטומטית) |
| ייבוא | העלאת קובץ **CSV / Excel** עם מיפוי עמודות |

## מה נבנה — מיפוי לדרישות

1. **כל נציג פותח פנייה לכל הזמנה, בלי לערוך את ההזמנה** — כפתור "קריאת שירות"
   במסך ההזמנה פותח את `OpenServiceTicketDialog` (פרטי ההזמנה לקריאה בלבד).
   `canOpenServiceTicket` מתיר לכל נציג מכירות/מפעל/אדמין.
2. **צירוף תמונות של בעיה במוצר** — `ServicePhotoUploader` (דחיסה + העלאה),
   נשמר ב-`support_tickets.photo_urls`. זמין בדיאלוג הנציג וגם בטופס הציבורי.
3. **ייבוא מהעבר (CSV/Excel)** — מפוצל לשניים:
   - **הזמנות** מיובאות מאזור **הגדרות → ייבוא נתונים** (`ImportOrders`).
     מקבלות `is_imported=true` + `tags=['הזמנה מיובאת']`, והתג מוצג ב-`/Orders`
     וב-`/OrderDetails`.
   - **פניות שירות** מיובאות מתוך **מרכז השירות** (`ImportServiceData`), וניתן
     לקשר כל פנייה להזמנה לפי מספר הזמנה.
4. **שיוך משימת שירות לנציג** — בעל הרשאת ניהול שירות (נתנאל) מ-`ServiceRequestDetails`
   פותח `AssignServiceTaskDialog` ויוצר `SalesTask` עם `task_type='service'`.
   המשימה מופיעה אצל הנציג (מתן) ב-`/SalesTasks` **בצבע רוז ייחודי** (אייקון
   LifeBuoy, תווית "פניית שירות"), מקושרת לפנייה דרך `sales_tasks.service_ticket_id`.
5. **SMS עם קישור לפתיחה עצמית ע״י הלקוח** — `SendServiceSmsDialog` (גם עצמאי
   וגם ממסך פנייה/הזמנה): הנציג מזין טלפון → נוצרת טיוטת פנייה עם `public_token`
   ו-`public_status='pending'` → נשלח SMS דרך פונקציית `sendSms` (019). הלקוח
   נכנס לטופס הציבורי `/service-request?token=...`, ממלא: מתי הזמין, סוג פנייה
   (כללית / 30 ימי ניסיון / אחריות ארוכה עם שנות אחריות + לפני כמה זמן התחילה
   הבעיה), שאלות אבחון, ומצרף תמונות. בשליחה הפנייה מסומנת `opened_by_customer`,
   `source='customer_self'`, ונכנסת למרכז השירות.
6. **פתיחה ידנית ע״י הנציג** — אותו `OpenServiceTicketDialog`, גם בלי הזמנה
   (חיפוש לפי טלפון לקישור ללקוח/ליד).
7. **טופס ציבורי — טוקן בלבד, בתוקף 24 שעות (אנטי-ספאם)** — הדרך היחידה לפתוח
   פנייה היא דרך הקישור ש**הנציג שולח** ב-SMS (`/service-request?token=...`).
   הטוקן תקף 24 שעות מרגע השליחה (`public_sent_at`); אחריו `service_request_get`
   מחזיר `expired` והטופס מציג "הקישור פג תוקף". `service_request_submit` חוסם
   שליחה לאחר תפוגה. כניסה ל-`/service-request` ללא token מציגה "קישור לא תקין".
   *(ה-RPC הפתוח `service_request_create_public` הוסר — נדחה לטובת מודל הטוקן.)*
8. **צירוף חשבונית (לא חובה)** — הלקוח יכול לצרף חשבונית (תמונה או PDF) בטופס;
   נשמרת ב-`support_tickets.invoice_url` ומוצגת בפרטי הפנייה.

## תוספות שהוספתי (להחלטתך)

- **סטטוסים מורחבים** לפנייה: פתוחה / בטיפול / ממתין ללקוח / ממתין לחלקים-מפעל /
  נפתרה / סגורה — עם צבעים.
- **הערות פנימיות (timeline)** על כל פנייה.
- **גלריית תמונות** עם תצוגה מוגדלת (lightbox).
- **שאלות אבחון** מובנות (ניתן להרחיב ב-`src/constants/serviceOptions.js`).
- **העדפת יצירת קשר** (טלפון/וואטסאפ/אימייל) בטופס הציבורי.
- **KPIs**: פתוחות / חריגת SLA / נפתחו ע״י לקוח / ממתין למילוי לקוח / נפתרו היום.
- **התראה לנציג** (best-effort) בעת שיוך משימת שירות.
- **נפילה רכה ל-SMS**: גם לפני חיבור 019, נוצר קישור להעתקה + כפתור וואטסאפ.

## קבצים עיקריים

```
supabase/migrations/20260529000001_service_center.sql   הרחבת טבלאות + RPCs + storage policy
supabase/migrations/20260602000002_service_request_public_intake.sql  RPC ציבורי לפתיחה עצמאית + שיוך אוטומטי
supabase/migrations/20260602000001_schedule_voicenter_sync.sql  תזמון pg_cron לסנכרון שיחות Voicenter
supabase/functions/sendSms/index.ts                     שליחת SMS דרך 019
src/constants/serviceOptions.js                          קבועים משותפים (סוגים/סטטוסים/שאלות)
src/components/service/ServicePhotoUploader.jsx          העלאת תמונות רב-פעמית
src/components/service/OpenServiceTicketDialog.jsx       פתיחת פנייה ע״י נציג
src/components/service/AssignServiceTaskDialog.jsx       שיוך משימת שירות לנציג
src/components/service/SendServiceSmsDialog.jsx          שליחת קישור SMS ללקוח
src/components/service/ImportServiceData.jsx             ייבוא פניות שירות (CSV/Excel)
src/components/service/ImportOrders.jsx                  ייבוא הזמנות (CSV/Excel) — מ-Settings
src/utils/importFile.js                                  פענוח CSV/Excel משותף
src/pages/ServiceCenter.jsx                              רשימת/דשבורד מרכז השירות
src/pages/ServiceRequestDetails.jsx                      מסך פרטי פנייה
src/pages/ServiceRequestPublic.jsx                       טופס ציבורי (ללא התחברות)
```

נגיעות קטנות: `App.jsx` (נתיב ציבורי `/service-request`), `Layout.jsx` (ניווט
"מרכז שירות"), `pages.config.js`, `SalesTasks.jsx` (צבע משימת שירות),
`Orders.jsx` + `OrderDetails.jsx` (תג "הזמנה מיובאת"), `lib/rbac.js` +
`components/shared/rbac.jsx` (`canManageService`).

## שלבי הפעלה (Deploy)

1. **הרצת המיגרציה** `20260529000001_service_center.sql` על ה-DB — מוסיפה את
   העמודות החדשות, ה-RPCs הציבוריים, ומדיניות ה-storage. **חובה לפני שימוש** —
   הקוד שולח את העמודות החדשות (כמו `photo_urls`, `request_type`).
2. **פריסת הפונקציה** `sendSms`.
3. **הגדרת secrets** ב-Supabase כדי לאפשר שליחת SMS דרך 019:
   - `SMS_019_TOKEN` — טוקן API (019 → הגדרות → ניהול טוקן API)
   - `SMS_019_USERNAME` — שם המשתמש בחשבון 019
   - `SMS_019_SENDER` — שם/מזהה שולח מאושר
   ללא ה-secrets — הכל עובד, פרט לשליחה האוטומטית: יוצג קישור להעתקה + וואטסאפ.
4. **מתן הרשאה** למנהל/ת השירות: `users.can_manage_service = true` (אדמין כבר מקבל).

## הערות / לבדיקה מולך

- **ייבוא הזמנות**: עמודות החובה בפועל של טבלת `orders` עלולות לדרוש שדות נוספים
  מעבר ל-`order_number/customer_name/total`. אם ייבוא נכשל על שורות — נצטרך את
  רשימת העמודות הנדרשות ואתאים את ה-mapping.
- **העלאת תמונות בטופס הציבורי**: מתבצעת ל-bucket `uploads` תחת התיקייה
  `service-requests/` בלבד (מדיניות anon מצומצמת). ה-RPC מאמת שכל URL מצביע
  ל-bucket שלנו.
