-- The leads table accumulated raw Hebrew status strings (and a handful of
-- mojibake-corrupted variants) instead of the English keys the codebase
-- compares against ('deal_closed', 'no_answer_1', etc). That made every
-- dashboard and aggregate dependent on status look near-empty:
--   * /Marketing showed 0% conversion
--   * /LandingPages reported 0 won_leads
--   * rep_stats view counted 0 closed_won per rep
--   * 'WHERE status = ''deal_closed''' returned 2 rows out of ~16k real wins
--
-- Map every known stored value to its canonical English key in one
-- transaction. Unknown / future statuses are left untouched — this is a
-- one-shot data normalization, not a constraint.
--
-- The mapping table below is keyed on the EXACT bytes the inventory query
-- returned (some entries are duplicates with different mojibake characters
-- — those rows still get normalized too).

BEGIN;

-- 1. Canonical mapping (Hebrew/raw → English key) ---------------------------
WITH status_map (source, target) AS (
  VALUES
    -- Closed deal (the 16019 row case the user noticed)
    ($$נסגרה עסקה$$,                                  'deal_closed'),
    ($$נסגרה ��סקה$$,                                  'deal_closed'),

    -- Lead lifecycle
    ($$ליד חדש$$,                                       'new_lead'),
    ($$ליד קו שני$$,                                    'second_line_lead'),
    ($$ליד רותח$$,                                       'hot_lead'),
    ($$שנה כיוון לליד$$,                                 'changed_direction'),
    ($$יגיע לסניף לפגישה$$,                              'will_arrive_for_meeting'),
    ($$לבצע שיחת מנהל - פוטנציאלי לסגירה$$,              'manager_call_potential_close'),
    ($$הועבר ע''י מנהל - להמשך טיפול$$,                  'transferred_by_manager_for_followup'),
    ($$נסגר ע''י מנהל - הועבר לדיוור$$,                  'closed_by_manager_to_mailing'),
    ($$��סגר ע''י מנהל - הועבר לדיוור$$,                  'closed_by_manager_to_mailing'),
    ($$שיחה מגוגל$$,                                    'call_from_google'),
    ($$שיחה מפייסבוק$$,                                 'call_from_facebook'),
    ($$כבר רכש ב - King David התקשר לבירור$$,           'already_purchased_inquiry'),
    ($$בדיקת מערכת$$,                                   'system_test'),

    -- Followup
    ($$פולואפ - אחרי הצעת מחיר$$,                       'followup_after_quote'),
    ($$פולואפ - אח��י הצעת מחיר$$,                       'followup_after_quote'),
    ($$פולואפ - לפני הצעה$$,                            'followup_before_quote'),
    ($$לחזור לפולואפ$$,                                 'return_to_followup'),

    -- No-answer (numbered + variants)
    ($$ללא מענה 1$$,                                    'no_answer_1'),
    ($$ללא מענה 2$$,                                    'no_answer_2'),
    ($$ללא מענה 3$$,                                    'no_answer_3'),
    ($$ללא מענה 4$$,                                    'no_answer_4'),
    ($$ללא מענה 5$$,                                    'no_answer_5'),
    ($$אין מענה - 8 חיוגים$$,                            'no_answer_8_calls'),
    ($$ללא מענה - נשלח ווטסאפ$$,                        'no_answer_whatsapp_sent'),

    -- "Not relevant" set (these are the closed-status set the views care about)
    ($$לא רלוונטי - ליד כפול$$,                          'not_relevant_duplicate'),
    ($$לא רלוונטי - ליד כ��ול$$,                          'not_relevant_duplicate'),
    ($$לא רלוונטי – רכש במקום אחר$$,                     'not_relevant_bought_elsewhere'),
    ($$לא רלוונטי – ��כש במקום אחר$$,                     'not_relevant_bought_elsewhere'),
    ($$לא רלוונטי – רכש במק��ם אחר$$,                     'not_relevant_bought_elsewhere'),
    ($$לא רלוונטי – מכחיש פניה$$,                        'not_relevant_denies_contact'),
    ($$לא רלוונטי - מחפש מזרן ב1,000 ש''ח$$,             'not_relevant_1000_nis'),
    ($$לא רלוונ��י - מחפש מזרן ב1,000 ש''ח$$,             'not_relevant_1000_nis'),
    ($$לא רלוונטי - לא מסביר למה$$,                      'not_relevant_no_explanation'),
    ($$לא רלוונטי - לא מסביר ��מה$$,                      'not_relevant_no_explanation'),
    ($$לא רלוונטי - לא מסב��ר למה$$,                      'not_relevant_no_explanation'),
    ($$לא רלוונטי - ליד לא בשל לעסקה$$,                  'not_relevant_not_mature'),
    ($$לא רלוונטי - ליד לא ��של לעסקה$$,                  'not_relevant_not_mature'),
    ($$לא רלוונטי - ��יד לא בשל לעסקה$$,                  'not_relevant_not_mature'),
    ($$לא רלוונטי - מס' שגוי$$,                          'not_relevant_wrong_number'),
    ($$לא רלוונטי שירות$$,                               'not_relevant_service'),
    ($$לא מעונין לדבר - מנתק$$,                          'not_interested_hangs_up'),
    ($$שמע מחיר ולא מעונין לשמוע עוד$$,                  'heard_price_not_interested'),
    ($$שמע מחיר ולא מעו��ין לשמוע עוד$$,                  'heard_price_not_interested'),
    ($$שמע מחיר ולא מעונין לשמוע ע��ד$$,                  'heard_price_not_interested'),
    ($$ש��ע מחיר ולא מעונין לשמוע עוד$$,                  'heard_price_not_interested'),
    ($$מחפש מוצרים שלא קיימים בחברה$$,                  'products_not_available'),
    ($$גר רחוק - חושש מקניה בטלפון$$,                    'lives_far_phone_concern'),
    ($$דיוור חוזר - ביקש להסיר$$,                        'mailing_remove_request'),

    -- Customer-service statuses
    ($$שירות לקוחות-טופל$$,                              'service_handled'),
    ($$שירות לקוחות-מסגרת 30 לילות ניסיון$$,             'service_30_nights_trial'),
    ($$שירות לקוחות-מסגרת 30 לילות ניסיון טופל$$,        'service_30_nights_trial_handled'),
    ($$שירות לקוחות-תעודת אחריות$$,                      'service_warranty'),
    ($$שירות לקוחות-תעודת אחריות טופל$$,                 'service_warranty_handled'),
    ($$שירות לקוחות -ביטולים$$,                          'service_cancellations'),
    ($$שירות לקוחות -ביטולים טופל$$,                     'service_cancellations_handled'),
    ($$שירות לקוחות -חוסרים בהזמנה$$,                    'service_missing_items'),
    ($$שירות לקוחות -חוסרים בהזמנה טופל$$,               'service_missing_items_handled'),
    ($$בירור אספקה$$,                                    'delivery_inquiry'),
    ($$בירור אספקה - טופל$$,                             'delivery_inquiry_handled')
)
UPDATE public.leads l
SET status = m.target
FROM status_map m
WHERE l.status = m.source;

-- 2. Normalize blanks to new_lead so the dashboards stop counting them
--    as a "non-status" bucket.
UPDATE public.leads
SET status = 'new_lead'
WHERE status IS NULL OR btrim(status) = '';

COMMIT;

-- 3. Refresh PostgREST schema cache (no schema change but doesn't hurt).
NOTIFY pgrst, 'reload schema';

-- 4. Sanity-check query — paste into the SQL Editor after the migration
--    runs to confirm everything is normalized:
--
--      SELECT status, COUNT(*) AS count
--      FROM public.leads
--      GROUP BY status
--      ORDER BY count DESC;
--
--    Expectation: 'deal_closed' shows ~16019, only English keys (and any
--    statuses that weren't in the mapping above) should remain.
