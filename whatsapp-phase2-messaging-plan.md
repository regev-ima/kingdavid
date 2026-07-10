# וואטסאפ — שלב 2: שליחת הודעות, תבניות וקיצורי מקלדת — תוכנית עבודה

> **מסמך הוראות לביצוע בסשן חדש.** מודל מבצע: **Claude Sonnet**.
> המסמך עצמאי ומכיל את כל ההקשר, אבל הריפו חי ומתקדם — **חובה לקרוא כל קובץ לפני עריכתו** ולא להסתמך על הציטוטים כאן כאילו הם עדכניים.
> עבוד **שלב אחרי שלב לפי סעיף 9** (סדר ביצוע), עם קומיט ו-push בסוף כל שלב, ו-PR אחד כ-draft (ראה נספח 11 למוסכמות).

---

## 0) תקציר מנהלים

**שלב 1 (כבר ב-main, PR ‎#252):** שיקוף לקריאה-בלבד של הוואטסאפ של כל נציג דרך Green API — וובהוק קולט הודעות נכנסות/יוצאות, מסך "צ'אט וואטסאפ" (נציג=שלו, מנהל=הכל + מבט-על), באנר "ממתין לתשובה", פאנל הקשר CRM, כפתור צ'אט בליד, מדדי זמן תגובה, ומחיקת היסטוריה.

**שלב 2 (המסמך הזה):** הפיכת הצ'אט לדו-כיווני:
1. **שליחת הודעות טקסט** מתוך המערכת, דרך ה-Green API של הנציג עצמו.
2. **מערכת תבניות הודעה** בקטגוריות (מכירות / זמינות / שירות / כללי), בניהול מנהל.
3. **קיצורי מקלדת** בקומפוזר — הקלדת רצף (`/קיצור` + רווח) שולפת תבנית אוטומטית, בסגנון text-replacement של מק, + תפריט השלמה תוך כדי הקלדה.
4. **שליחת הצעת מחיר / הזמנה בוואטסאפ** עם **קובץ ה-PDF כצרופה**, מתוך מסכי ההצעה/ההזמנה ומפאנל ההקשר בצ'אט.

> ⚠️ **פיבוט מוצרי מפורש:** בשלב 1 הוחלט במפורש "המערכת רק מתעדת — לעולם לא שולחת". החלטה זו **מבוטלת בהוראת הלקוח**. יש לעדכן את כל הטקסטים והערות הקוד שמצהירות על קריאה-בלבד (רשימה סגורה בסעיף 8).

> ⚠️ **בדיקת קדם חובה (לפני שמתחילים):** שליחה ב-Green API מחייבת tariff מתאים. בקונסולת Green של הלקוח נצפה באנר **"Payment is required"** — במכסת החינם השליחה מוגבלת/חסומה. לוודא מול הלקוח שהאינסטנסים משודרגים, אחרת לבנות הכל ולבדוק על אינסטנס אחד פעיל.

---

## 1) מצב קיים — אינוונטר (מה כבר בנוי ב-main)

### Frontend (`src/`)
| קובץ | תפקיד |
|---|---|
| `pages/WhatsAppChat.jsx` | המסך הראשי: רשימת שיחות + שרשור (קריאה-בלבד כרגע), פאנל הקשר CRM (xl / Sheet), מבט-על מנהל, סינון סטטוס/נציג/חיפוש, deep-links‏ `?focus=waiting` ו-`?chat=<id>`, "סמן כטופל", Realtime + polling |
| `components/whatsapp/whatsappHelpers.js` | `chatStatusMeta`, `chatTitle`, `prettyPhone`, `listTime`, `dayLabel`, `formatDuration`, `elapsedSeconds`, `colorFromString` |
| `components/whatsapp/MessageBubble.jsx` | בועת הודעה (טקסט/תמונה/וידאו/אודיו/מסמך/מיקום) |
| `components/whatsapp/WhatsAppWaitingBanner.jsx` | באנר אדום דביק לנציג + טיימר "ממתין X" (Realtime + poll), קישור `?focus=waiting` |
| `components/whatsapp/WhatsAppContextPanel.jsx` | פאנל הקשר: לקוח קיים/חדש, לידים/הצעות/הזמנות/פניות, פעולות (פתח ליד, צור ליד, פניית שירות, התקשר) |
| `components/whatsapp/useWhatsAppContext.js` | `phoneTail(phone)` (9 ספרות אחרונות), `isOpenTicket`, `useWhatsAppContext(phone)` — חיפוש בכל הישויות לפי טלפון |
| `components/whatsapp/WhatsAppManagerOverview.jsx` | קוביות פר-נציג בעיצוב "עומס לפי נציג", מסנן תקופה, לחיצה-מסננת |
| `components/whatsapp/WhatsAppRepStats.jsx` | טבלת מדדים — **כרגע לא בשימוש** (הוחלף במבט-על). מועמד למחיקה בשלב 2 |
| `components/whatsapp/LeadWhatsAppChatButton.jsx` | כפתור בליד שפותח את השיחה בפופ-אפ (קריאה-בלבד כרגע) |
| `components/representatives/WhatsAppSettingsTab.jsx` | טאב "וואטסאפ" בניהול נציג: קודי Green, חבר וובהוק, בדוק, אבחון, מחיקת היסטוריה (אדמין) |
| `Layout.jsx` | פריטי ניווט "צ'אט וואטסאפ" (אדמין + נציג) + הרכבת הבאנר (לנציגים, sticky) |
| `api/entities.js` | ‏TABLE_MAP כולל `WhatsAppAccount/Chat/Message/RepStats` |

### Backend (`supabase/`)
| קובץ | תפקיד |
|---|---|
| `functions/_shared/greenApi.ts` | `callGreenApi(acc, method, body?)` — בונה `{apiUrl}/waInstance{id}/{method}/{token}`; ‏`getStateInstance`, `getGreenSettings`, `setWebhookSettings` (טוקן ב-`?token=` ב-URL, בלי Authorization header!), `normalizeWebhook` |
| `functions/greenApiSettings/index.ts` | actions: `get` / `save` / `connect` / `check` / `list` / `diagnose` / `purge` (אדמין). טוקן נשמר רק בשרת; הדפדפן מקבל hint ממוסך |
| `functions/greenApiWebhook/index.ts` | ציבורי (`--no-verify-jwt`), מאמת טוקן מ-`?token=` **או** Bearer, dedupe לפי `(account_id, green_message_id)`, כותב chat+message, נכנסת→`waiting`, יוצאת→`answered`, מעדכן `last_webhook_at` לפני אימות (לאבחון) |
| `migrations/20260625000002_whatsapp_chat.sql` | `whatsapp_accounts` (RLS נעול, שרת בלבד), `whatsapp_chats`, `whatsapp_messages`, RLS קריאה (נציג=שלו/אדמין=הכל, התאמה `auth_id` **או** `email`), ‏`GRANT UPDATE (status, unread_count)` בלבד ללקוח, Realtime publication, view ‏`whatsapp_rep_stats` (security_invoker) |
| `.github/workflows/whatsapp-chat-migrate.yml` | מריץ את המיגרציה דרך Supabase Management API ב-push ל-main |
| `.github/workflows/deploy-functions.yml` | פורס את כל הפונקציות עם `--no-verify-jwt`; ‏`greenApiSettings`+`greenApiWebhook` כבר ברשימה |

### עקרונות שנשמרים גם בשלב 2
- **הטוקנים של Green לעולם לא מגיעים לדפדפן.** כל פעולה מולם — רק דרך Edge Functions (service role).
- **ללקוח אין ולא יהיה GRANT INSERT/DELETE** על טבלאות הוואטסאפ. שליחה = דרך פונקציה בלבד.
- סטטוס שיחה: הודעה נכנסת אחרונה → `waiting` (אדום); יוצאת אחרונה → `answered` (ירוק).
- ‏RLS: נציג רואה/פועל רק על מה ששלו; אדמין על הכל; התאמת משתמש תמיד `u.auth_id = auth.uid() OR u.email = auth.jwt()->>'email'`.

---

## 2) אפיקי עבודה (Epics)

- **E1 — שליחת טקסט מהצ'אט** (Edge Function + קומפוזר)
- **E2 — מערכת תבניות** (טבלה + RLS + מסך ניהול לאדמין)
- **E3 — קיצורי מקלדת והשלמה** בקומפוזר
- **E4 — שליחת הצעה/הזמנה כ-PDF מצורף**
- **E5 — עדכוני שפה, ניקיונות ובונוסים**

---

## 3) DB — מיגרציה חדשה

קובץ: `supabase/migrations/<תאריך>_whatsapp_phase2.sql` (idempotent, `BEGIN/COMMIT`, ‏`NOTIFY pgrst, 'reload schema'` בסוף — כמו המיגרציות הקיימות).

```sql
-- 1) טבלת תבניות
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category      text NOT NULL DEFAULT 'general'
                CHECK (category IN ('sales','availability','service','general')),
  title         text NOT NULL,
  body          text NOT NULL,          -- תומך ב-placeholders, ראה סעיף 6
  shortcut      text,                   -- קיצור להשלמה (ללא '/'), אותיות/ספרות בלבד
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_by    text,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_templates_shortcut_key
  ON public.whatsapp_templates (shortcut) WHERE shortcut IS NOT NULL;

-- טריגר touch — לעשות שימוש חוזר ב-public.trg_whatsapp_touch_updated_date (קיים משלב 1)

-- RLS: כולם קוראים; רק אדמין כותב (דפוס dual-match כמו בשאר הטבלאות)
-- GRANT SELECT, INSERT, UPDATE, DELETE ל-authenticated + פוליסות:
--   select: TO authenticated USING (true)
--   insert/update/delete: רק כשקיים users עם auth_id/email תואם ו-role='admin'

-- 2) עמודות תיעוד שליחה על הודעות (אדיטיבי)
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS sent_via_app boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sent_by      text,
  ADD COLUMN IF NOT EXISTS template_id  uuid;
```

**Workflow:** ליצור `.github/workflows/whatsapp-phase2-migrate.yml` — העתק מדויק של `whatsapp-chat-migrate.yml` עם ה-paths של הקובץ החדש. טריגר: `main` + ענף הפיתוח של הסשן החדש (לבדיקות preview; להסיר את טריגר-הענף לפני המיזוג או מיד אחריו).

**entities:** להוסיף `WhatsAppTemplate: 'whatsapp_templates'` ל-`TABLE_MAP` ב-`src/api/entities.js`.

---

## 4) Edge Function חדש — `greenApiSend`

קובץ: `supabase/functions/greenApiSend/index.ts` + הוספה לרשימת `FUNCTIONS` ב-`deploy-functions.yml`.

### חוזה
```jsonc
// POST body
{
  "action": "text" | "file",
  // יעד — אחד מהשניים:
  "chat_ref": "<uuid של whatsapp_chats>",   // שיחה קיימת (המסלול הרגיל מהצ'אט)
  "phone": "0501234567",                    // אין שיחה — למשל שליחת הצעה לליד
  // אדמין בלבד: שליחה דרך חשבון של נציג מסוים (ברירת מחדל: ראה "רזולוציית חשבון")
  "as_user_id": "<uuid users>",
  "message": "טקסט ההודעה (או caption לקובץ)",
  "file_url": "https://.../quote-1234.pdf", // action=file בלבד; חייב URL ציבורי
  "file_name": "הצעת-מחיר-1234.pdf",
  "template_id": "<uuid>"                   // אופציונלי, לתיעוד בלבד
}
// תשובה: { ok: true, idMessage, chat_ref } או { ok: false, error }
```

### לוגיקה (לפי הדפוס של `greenApiSettings`)
1. `getUser(req)` → 401 אם אין; לזהות את פרופיל ה-users (id/role/email/full_name).
2. **רזולוציית חשבון שולח:**
   - יש `chat_ref` → החשבון הוא `whatsapp_chats.account_id` של השיחה. מותר אם המשתמש הוא בעל השיחה (`user_id`) או אדמין. (אדמין ששולח דרך חשבון של נציג — זה מודע ומכוון; ה-UI מציג זאת, ראה סעיף 5.)
   - אין `chat_ref` → `as_user_id` (אדמין בלבד) או חשבון המשתמש עצמו. אם למשתמש אין `whatsapp_accounts` מוגדר/מחובר → `{ ok:false, error:'not_configured' }`.
3. **Guard:** אם `state != 'authorized'` — לרענן פעם אחת עם `getStateInstance` ואם עדיין לא — `{ ok:false, error:'instance_not_authorized' }`.
4. **חישוב chatId:** משיחה קיימת — `chat_id` שלה; מטלפון — `normalizeIsraeliPhone` (לממש עותק ב-TS בתוך `_shared/greenApi.ts`; הלוגיקה זהה ל-`src/utils/phoneUtils.js`) → `"9725XXXXXXXX@c.us"`.
5. **קריאת Green** — להוסיף ל-`_shared/greenApi.ts`:
   ```ts
   export async function sendTextMessage(acc, chatId, message)   // POST sendMessage {chatId, message}
   export async function sendFileByUrl(acc, chatId, urlFile, fileName, caption) // POST sendFileByUrl
   ```
   כישלון HTTP/גוף שגיאה → להחזיר `{ ok:false, error:'green_send_failed', details }` עם `console.error`.
6. **כתיבה ל-DB (service role):**
   - upsert שיחה (מצא לפי `account_id+chat_id`, צור אם אין — כמו בוובהוק, כולל טיפול במרוץ).
   - insert ל-`whatsapp_messages`: ‏`direction:'outgoing'`, ‏`green_message_id: idMessage` מהתשובה, ‏`message_type` (‏text / לפי סיומת הקובץ: pdf→document, jpg/png→image), ‏`body=message`, ‏`media_url/file_name` לקובץ, ‏`msg_timestamp: now`, ‏`sent_via_app:true`, ‏`sent_by: user.email`, ‏`template_id`.
   - עדכון סיכום השיחה: ‏`last_message_* `, ‏`status:'answered'`, ‏`unread_count:0`.
   - **Dedupe מובטח:** Green ישלח גם וובהוק `outgoingAPIMessageReceived` עם אותו `idMessage` — האינדקס הייחודי `(account_id, green_message_id)` משלב 1 כבר מונע כפילות. לוודא שה-insert בוובהוק מטפל בשגיאת conflict בשקט (כיום יש בדיקת dupe לפני insert — מספיק).
7. **Rate-guard רך (מומלץ):** ‏count הודעות `sent_via_app` ב-60 השניות האחרונות לאותו חשבון; מעל 20 → `{ ok:false, error:'rate_limited' }`.

---

## 5) קומפוזר — שליחה מהצ'אט (E1 + E3 UI)

קומפוננטה חדשה: `src/components/whatsapp/WhatsAppComposer.jsx`, משולבת **בשני מקומות**: תחתית ה-Thread ב-`WhatsAppChat.jsx` (במקום פוטר ה"תצוגה בלבד") ותחתית הפופ-אפ ב-`LeadWhatsAppChatButton.jsx`.

### התנהגות
- **הרשאה:** מוצג לבעל השיחה ולאדמין. לאדמין על שיחה של נציג אחר — שורת אזהרה קטנה: „ההודעה תישלח מהוואטסאפ של {שם הנציג}".
- **מצב לא מחובר:** אם לחשבון השולח אין קונפיג/authorized — להציג את הפוטר הנעול עם הסבר („החשבון לא מחובר — פנה למנהל") במקום הקומפוזר.
- Textarea ‏RTL עם auto-grow; ‏**Enter=שליחה, Shift+Enter=שורה חדשה**; כפתור שליחה (איקון Send, ירוק).
- **Optimistic UI:** הוספת ההודעה מיד לשרשור במצב "נשלחת…" (אפרפר); בהצלחה — invalidate ל-`['wa-messages', chatId]` ו-`['wa-chats']`; בכישלון — toast + החזרת הטקסט לקומפוזר.
- שליחה מוצלחת מנקה את הבאנר (השיחה הופכת `answered` בשרת) — לוודא invalidate גם ל-`['wa-waiting-count']`.
- **כפתור תבניות** (איקון ⚡/BookText) — פותח Popover עם טאבי קטגוריות + חיפוש; בחירה מזריקה את גוף התבנית (אחרי resolve placeholders) לקומפוזר (לא שולחת אוטומטית).

### קיצורי מקלדת (E3)
- הקלדת `/` **בתחילת ההודעה** פותחת dropdown השלמה מסונן חי לפי `shortcut` + `title` (חצים + Enter לבחירה, Esc לסגירה).
- **הרחבה אוטומטית בסגנון מק:** טוקן `/{shortcut}` שאחריו רווח — מוחלף מיידית בגוף התבנית (resolve placeholders). מימוש: ב-onChange לבדוק את הטוקן האחרון שהסתיים ברווח מול מפת הקיצורים (`useWhatsAppTemplates()` — hook חדש שמושך `WhatsAppTemplate.filter({is_active:true},'sort_order')` עם staleTime גבוה).
- Placeholders נתמכים (resolve בצד לקוח, helper `resolveTemplate(body, ctx)` ב-`whatsappHelpers.js`):

| Placeholder | ערך |
|---|---|
| `{{שם}}` | מילה ראשונה של שם איש הקשר (chat.contact_name / שם הליד מהפאנל) |
| `{{שם_מלא}}` | שם איש הקשר המלא |
| `{{נציג}}` | `full_name` של המשתמש המחובר |
| `{{טלפון_נציג}}` | `phone` של המשתמש המחובר |
| placeholder לא מזוהה | נשאר כמו שהוא — לא מפיל כלום |

---

## 6) מסך ניהול תבניות (E2, אדמין)

- **מיקום:** מסך ההגדרות עבר רה-ארגון ב-main („ניווט כרטיסים", PR ‎#258) — **לקרוא קודם את `src/pages/Settings.jsx` הנוכחי** ולהוסיף כרטיס/טאב חדש „תבניות וואטסאפ" לפי הדפוס הקיים (אדמין בלבד), קומפוננטה: `src/components/settings/WhatsAppTemplatesTab.jsx`.
- **UI:** טאבים/פילטר לפי קטגוריה — מכירות / זמינות / שירות / כללי. רשימת תבניות עם: כותרת, תצוגת גוף מקוצרת, badge קיצור (`/מחיר1`), מתג פעיל, עריכה, מחיקה (עם אישור), והוספה.
- **טופס תבנית:** קטגוריה (Select), כותרת, גוף (Textarea עם כפתורי-עזר להזרקת placeholders), קיצור (אופציונלי; ולידציה: ללא רווחים ו-`/`, ייחודי — לאכוף גם בצד לקוח וגם ליהנות מהאינדקס הייחודי), סדר.
- **CRUD** ישירות דרך `base44.entities.WhatsAppTemplate` (ה-RLS מגן; אין צורך בפונקציה).
- **בונוס אופציונלי (אם הזמן מאפשר):** כפתור „✨ נסח עם AI" שממלא גוף תבנית דרך `base44.functions.invoke('invokeLLM', {prompt})` (הפונקציה קיימת ופרוסה).
- **Seed:** במיגרציה להוסיף 3–4 תבניות דוגמה (אחת לכל קטגוריה) עם `ON CONFLICT DO NOTHING`-style גארד (או `INSERT ... WHERE NOT EXISTS`) כדי שהמסך לא ייפתח ריק.

---

## 7) שליחת הצעת מחיר / הזמנה כ-PDF (E4)

### עיקרון
כפתור „שלח בוואטסאפ" שמייצר את ה-PDF, מעלה אותו ל-storage הציבורי, ושולח דרך `greenApiSend` עם `action:'file'` + caption מתבנית.

### שלבים
1. **איתור מנגנון ה-PDF הקיים:** בריפו יש `jspdf` + `html2canvas` (ראה `package.json`). לחפש `grep -rn "jsPDF\|jspdf\|html2canvas" src/` — צפוי ייצוא PDF קיים ב-`QuoteDetails.jsx` (ואולי בהזמנות). **לחלץ את הייצור ל-helper שמחזיר `Blob`** (למשל `src/components/quote/quotePdf.js`) כך שגם כפתור ההורדה הקיים וגם השליחה משתמשים בו. אם אין מנגנון להזמנות — לממש מינימלי באותו סגנון או להשמיט הזמנות בשלב ראשון (לתעד ב-PR).
2. **העלאה:** `base44.integrations.Core.UploadFile({ file: new File([blob], fileName, {type:'application/pdf'}) })` → מחזיר `file_url` ציבורי מ-bucket‏ `uploads` (Green חייב URL נגיש פומבית — זה מתקיים).
3. **נמען:** הצעה — טלפון הליד (`lead.phone` דרך `lead_id`); הזמנה — `order.customer_phone`. אם חסר טלפון — כפתור disabled עם title מסביר.
4. **קריאה:** `greenApiSend` עם `phone` (או `chat_ref` אם קיימת שיחה — אפשר לחפש עם `phoneTail`), ‏`file_url`, ‏`file_name` (למשל `הצעת-מחיר-{quote_number}.pdf`), ‏`message` = caption מתבנית ברירת-מחדל (קטגוריה sales) או טקסט קבוע: „היי {{שם}}, מצורפת הצעת המחיר שלך מקינג דוד 🙏".
5. **נקודות כניסה:**
   - `pages/QuoteDetails.jsx` — כפתור ליד ייצוא ה-PDF הקיים.
   - `pages/OrderDetails.jsx` (או המודל של הזמנה — לאתר את המסך הנוכחי) — אותו דבר.
   - **בונוס:** בפאנל ההקשר בצ'אט (`WhatsAppContextPanel`) — כפתור קטן „שלח בוואטסאפ" על כל הצעה/הזמנה ברשימה.
6. **חוויית משתמש:** דיאלוג אישור קטן לפני שליחה (נמען + שם קובץ + caption ניתן לעריכה) → שליחה → toast הצלחה → ההודעה תופיע בצ'אט (התיעוד קורה בפונקציה).

---

## 8) עדכוני שפה וניקיונות (E5) — רשימה סגורה

הפיבוט מחייב עדכון של כל מקום שמצהיר "קריאה בלבד / לא שולחים":

1. `pages/WhatsAppChat.jsx` — פוטר ה-Thread‏ („תצוגה בלבד — לא ניתן לשלוח...") → מוחלף בקומפוזר; תיאור העמוד בכותרת („תיעוד... תצוגה בלבד") → למשל „שיחות הוואטסאפ שלך · מחובר ל-Green API"; ה-empty-state.
2. `components/whatsapp/LeadWhatsAppChatButton.jsx` — פוטר „תצוגה בלבד" → קומפוזר/הסרה.
3. `components/representatives/WhatsAppSettingsTab.jsx` — האינפו-בוקס („המערכת **רק מתעדת**... היא לא שולחת הודעות") → נוסח דו-כיווני.
4. הערות קוד: כותרות `_shared/greenApi.ts` (‏"We never call sendMessage"), ‏`greenApiWebhook/index.ts`, וכותרת המיגרציה משלב 1 — לעדכן את ההערה (בקובץ מיגרציה קיים **לא** משנים SQL, רק אם נוגעים בהערות — עדיף להשאיר ולתעד את הפיבוט בכותרת המיגרציה החדשה).
5. **בונוס מבוקש מהלקוח:** ב-`WhatsAppSettingsTab` קיים „מחק את כל היסטוריית ההודעות" פר-נציג. להוסיף למסך המבט-על של המנהל (או להגדרות) כפתור **„נקה את כל ההיסטוריה של כולם"** — action חדש `purge_all` ב-`greenApiSettings` (אדמין; לולאה על כל החשבונות, אותו קוד כמו `purge`).
6. ניקיון: למחוק את `components/whatsapp/WhatsAppRepStats.jsx` אם אין בו שימוש (`grep -rn "WhatsAppRepStats" src/`).
7. אחרי סיום הבדיקות: להסיר את טריגר ענף-הפיתוח מה-workflows (להשאיר `main`).

---

## 9) סדר ביצוע מחייב (שלב = קומיט)

| # | שלב | תלוי ב- | Definition of Done |
|---|---|---|---|
| 1 | מיגרציה (templates + עמודות messages) + workflow חדש + entities | — | ה-workflow רץ בהצלחה על ענף הפיתוח (להוסיף את הענף לטריגר); `whatsapp_templates` קיימת |
| 2 | ‏helpers שליחה ב-`_shared/greenApi.ts` + פונקציית `greenApiSend` + הוספה ל-deploy-functions | 1 | הפונקציה פרוסה; בדיקת curl ידנית לא נדרשת (רשת חסומה בסביבת הפיתוח) — בדיקה דרך ה-UI בשלב 3 |
| 3 | `WhatsAppComposer` + שילוב ב-Thread ובפופ-אפ הליד + optimistic + הרשאות | 2 | שליחת טקסט מהפריוויו מגיעה לוואטסאפ אמיתי ונרשמת בצ'אט; שיחה `waiting` הופכת `answered`; הבאנר נעלם |
| 4 | מסך ניהול תבניות בהגדרות + seed | 1 | אדמין יוצר/עורך/מוחק; נציג לא רואה את מסך הניהול אך התבניות נטענות אצלו |
| 5 | קיצורים והשלמה בקומפוזר + placeholders | 3,4 | `/` פותח תפריט; `/קיצור`+רווח מתרחב; `{{שם}}` מוחלף |
| 6 | שליחת PDF — הצעה (+הזמנה אם קיים מנגנון) + כפתורים | 2 | קובץ מתקבל בוואטסאפ כצרופה + caption; ההודעה מתועדת עם `media_url` |
| 7 | עדכוני שפה + purge_all + ניקיונות (סעיף 8) | 3 | ‏`grep -rn "תצוגה בלבד" src/` נקי מהקשרי וואטסאפ |
| 8 | ‏QA מלא (סעיף 10), הסרת טריגרי ענף, PR מוכן | הכל | כל הצ'קליסט עובר |

**בכל שלב:** `npm run lint` (רק שהקבצים שנגעת בהם נקיים — יש שגיאות ישנות בקבצים אחרים), `npm run build` (חייב exit 0), קומיט בעברית, push.

## 10) צ'קליסט QA ידני (לביצוע עם הלקוח בפריוויו)

- [ ] נציג שולח טקסט משיחה קיימת → מגיע לנייד הלקוח, מופיע בצ'אט כבועה ירוקה, השיחה `answered`, הבאנר ירד.
- [ ] הודעה נכנסת חדשה אחרי תשובה → חוזרת `waiting` + באנר (התנהגות שלב 1 לא נשברה).
- [ ] אדמין שולח משיחה של נציג → נשלח מהאינסטנס של הנציג + מוצגת האזהרה + `sent_by` = מייל האדמין.
- [ ] נציג ללא חשבון מחובר → קומפוזר נעול עם הסבר; אין קריאת שרת.
- [ ] תבנית: יצירה ע"י אדמין, `/` בקומפוזר מציג אותה, `/קיצור`+רווח מתרחב, `{{שם}}` מוחלף בשם איש הקשר.
- [ ] נציג מנסה לערוך תבנית ישירות (DevTools) → RLS חוסם.
- [ ] שליחת הצעת מחיר → PDF נפתח בוואטסאפ של הלקוח; ההודעה בצ'אט עם איקון מסמך.
- [ ] ליד ללא טלפון → כפתור השליחה disabled.
- [ ] אין הודעות כפולות (echo של הוובהוק מסונן ע"י dedupe).
- [ ] `purge_all` מוחק הכל; תיעוד חדש ממשיך אחרי המחיקה.
- [ ] מובייל: קומפוזר שמיש, המסך לא נגלל אנכית מחוץ לפאנלים.

## 11) נספח — מוסכמות הריפו (חובה לסשן החדש)

- **Stack:** React 18 + Vite, Tailwind + shadcn/ui (`src/components/ui`), TanStack Query v5, Supabase (Postgres + RLS + Edge Functions/Deno). RTL עברית בכל UI חדש (`dir="rtl"`).
- **גישת דאטה:** `base44.entities.<Entity>` (proxy ב-`src/api/entities.js`, מוסיפים טבלה חדשה ל-TABLE_MAP); פונקציות — `base44.functions.invoke('name', params)`.
- **הרצה:** `npm install`, `npm run lint`, `npm run build`. אין טסטים אוטומטיים בריפו.
- **Git:** לעבוד על ענף `claude/...` של הסשן; קומיטים בעברית (שורת נושא + גוף מוסבר); push עם `-u origin <branch>`; לפתוח PR‏ draft ל-main עם תיאור בעברית.
- **פריסה:** ‏Vercel בונה preview לכל push (frontend בלבד!). ‏Edge Functions + מיגרציות נפרסים רק דרך ה-GitHub workflows — כברירת מחדל על push ל-main; לבדיקת preview מלאה יש להוסיף זמנית את ענף הפיתוח ל-`branches:` של `deploy-functions.yml` ושל ה-workflow של המיגרציה (ולוודא שה-paths כוללים את הקבצים שנגעת בהם) — כפי שנעשה בשלב 1. **להסיר לפני מיזוג.**
- **סודות:** אין להוסיף secrets חדשים — הכל עובד עם `SUPABASE_URL`/service-role הקיימים בפונקציות ו-`SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` ב-workflows.
- **רשת בסביבת הפיתוח חסומה ל-Supabase** — אי אפשר curl ישיר לפונקציות; מאמתים דרך ה-UI בפריוויו ולוגי ה-workflows.
- **עיצוב:** להתאים לשפה הקיימת — קוביות בסגנון "עומס לפי נציג" (`RepWorkloadCard` ב-`pages/LeadManagement.jsx`), צבעי סטטוס (רד=ממתין, ירוק=טופל), `shadow-card`, `rounded-xl`.
- **הודעה ללקוח בסוף:** לסכם בעברית, לצרף קישור פריוויו, ולפרט מה נדרש ממנו (שדרוג tariff ב-Green אם צריך, בדיקת QA לפי סעיף 10).
