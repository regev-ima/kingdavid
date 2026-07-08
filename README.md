# King David CRM

מערכת CRM בעברית (RTL) לניהול לידים, משימות מכירה, הצעות מחיר, הזמנות, ייצור (מפעל), משלוחים, מלאי, שירות לקוחות והנהלת חשבונות — עבור עסק המזרונים/מיטות King David.

## סטאק

- **Frontend:** React 18 + Vite, TailwindCSS, shadcn/ui (Radix), react-query, react-router. נפרס ב-**Vercel**.
- **Backend:** **Supabase** — PostgreSQL (PostgREST), Auth, Storage, Edge Functions (Deno).
- שכבת הגישה לנתונים: `src/api/entities.js` (עטיפה בסגנון base44: `base44.entities.X.list/filter/create/update/delete`) מעל `src/api/supabaseClient.js`.

## הרצה מקומית

```bash
npm install
cp .env.example .env.local   # ולמלא ערכים אמיתיים
npm run dev
```

משתני סביבה (`.env.local`):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

בדיקות איכות: `npm run lint` · בילד: `npm run build`.

## פריסה

- **Frontend:** כל push נפרס ב-Vercel (preview לברנץ', production ל-`main`).
- **מיגרציות DB:** קבצי SQL תחת `supabase/migrations/` מיושמים **רק במיזוג ל-`main`**, כל אחד ע"י GitHub Action ייעודי (`.github/workflows/*-migrate.yml`) שמריץ את הקובץ דרך ה-Supabase Management API. מיגרציה חדשה = קובץ SQL אידמפוטנטי + workflow תואם (העתיקו תבנית קיימת).
- **Edge Functions:** תחת `supabase/functions/`, נפרסות במיזוג ל-`main` ע"י `deploy-functions.yml` (שימו לב: רשימת הפונקציות בקובץ ה-workflow מפורשת — פונקציה חדשה חייבת להתווסף לרשימה).
- **Secrets נדרשים ב-GitHub:** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` (+ סודות הפונקציות מוגדרים ב-Supabase).

## מבנה הפרויקט (עיקרי)

```
src/
  api/           # supabase client + עטיפת entities (TABLE_MAP)
  pages/         # דף לכל route (נטען lazy דרך src/lib/pageRoutes.js)
  components/    # לפי תחום: lead/, quote/, order/, product/, factory/, shared/, ui/ (shadcn)
  lib/           # rbac.js (הרשאות), utilities
  hooks/
supabase/
  migrations/    # SQL אידמפוטנטי; רץ במיזוג דרך ה-workflows
  functions/     # Edge Functions (Deno)
docs/
  improvement-plan.md   # תוכנית עבודה מתמשכת
```

## הרשאות (RBAC)

תפקידים: `admin`, `sales_user` (נציג), `factory_user`, `bookkeeper` — קובעים תפריט ומסכים (`src/Layout.jsx`, `src/lib/rbac.js`). בנוסף, הרשאות נתינות פר-נציג (`users.extra_permissions`): ניהול מרכז שירות, צפייה בפיננסי, עדכון מרוכז, עריכת שיבוץ משמרות — מנוהלות מ"הגדרות → נציגים → נהל נציג → הרשאות".

## ניהול שוטף (אדמין)

- **משתמשים והרשאות:** הגדרות → נציגים.
- **SMS (019):** הגדרות → SMS — הטוקן נשמר צד-שרת בלבד.
- **ימי סגירה/חגים:** הגדרות → ימי סגירה.
- **קטלוג:** קטלוג מוצרים (מוצרים/וריאציות, תוספות, תצורת מיטות).
