import { createClientFromRequest, createClient } from 'npm:@base44/sdk@0.8.6';

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// הגדרות בטיחות מחמירות למניעת Rate Limit
const BATCH_SIZE = 8; 
const REQUEST_GAP = 2500; // 2.5 שניות בין פעולה לפעולה

/**
 * פונקציית עזר לביצוע פעולות מול ה-API עם מנגנון המתנה אם יש חסימה
 */
async function fetchWithRetry(fn, retries = 3, backoff = 5000) {
  try {
    return await fn();
  } catch (error) {
    const isRateLimit = error.message?.includes("Rate limit") || error.status === 429;
    if (isRateLimit && retries > 0) {
      console.warn(`⚠️ Rate limit hit. Waiting ${backoff/1000}s and retrying...`);
      await delay(backoff);
      return fetchWithRetry(fn, retries - 1, backoff * 2);
    }
    throw error;
  }
}

/**
 * פונקציית הליבה לסנכרון לידים ומשימות
 */
async function processSync(base44, email) {
  let updatedLeads = 0;
  let updatedTasks = 0;

  console.info(`\n🚀 Starting sync for rep: ${email}`);

  try {
    // 1. טיפול בלידים
    const leads = await fetchWithRetry(() => 
      base44.asServiceRole.entities.Lead.filter({
        pending_rep_email: email
      }, '', BATCH_SIZE)
    );

    if (leads && leads.length > 0) {
      console.info(`📂 Found ${leads.length} leads waiting for ${email}`);
      for (const lead of leads) {
        const success = await fetchWithRetry(async () => {
          await base44.asServiceRole.entities.Lead.update(lead.id, {
            rep1: email,
            pending_rep_email: ''
          });
          return true;
        }, 2, 10000);

        if (success) {
          updatedLeads++;
          const leadName = lead.first_name ? `${lead.first_name} ${lead.last_name || ''}` : (lead.name || lead.email || lead.id);
          console.info(`   ✅ [LEAD] Assigned: "${leadName}" to ${email}`);
          await delay(REQUEST_GAP);
        }
      }
    } else {
      console.info(`∅ No pending leads found for ${email}`);
    }

    // 2. טיפול במשימות (אם נשאר מקום במנה)
    if (updatedLeads < BATCH_SIZE) {
      const tasks = await fetchWithRetry(() => 
        base44.asServiceRole.entities.SalesTask.filter({
          pending_rep_email: email
        }, '', BATCH_SIZE - updatedLeads)
      );

      for (const task of tasks) {
        const success = await fetchWithRetry(async () => {
          await base44.asServiceRole.entities.SalesTask.update(task.id, {
            rep1: email,
            pending_rep_email: ''
          });
          return true;
        }, 2, 10000);

        if (success) {
          updatedTasks++;
          console.info(`   ✅ [TASK] Assigned task ID ${task.id} to ${email}`);
          await delay(REQUEST_GAP);
        }
      }
    }

    console.info(`🏁 Batch finished. Updated: ${updatedLeads} leads, ${updatedTasks} tasks.`);
    return { updatedLeads, updatedTasks, hasMore: (updatedLeads + updatedTasks) >= BATCH_SIZE };
  } catch (err) {
    console.error(`❌ Sync failed for ${email}:`, err.message);
    throw err;
  }
}

// --- שרת ה-HTTP (טריגר לנציג מחובר) ---
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let totalUpdatedLeads = 0;
    let totalUpdatedTasks = 0;
    let hasMoreToProcess = true;

    // רץ בלולאה עד שכל הלידים והמשימות ישויכו
    while (hasMoreToProcess) {
      const result = await processSync(base44, user.email);
      totalUpdatedLeads += result.updatedLeads;
      totalUpdatedTasks += result.updatedTasks;
      hasMoreToProcess = result.hasMore;
      
      if (hasMoreToProcess) {
        console.info(`⏳ More items to process, continuing...`);
        await delay(REQUEST_GAP);
      }
    }

    return Response.json({ 
      success: true, 
      data: {
        representative: user.email,
        leads_updated: totalUpdatedLeads,
        tasks_updated: totalUpdatedTasks
      },
      message: `Sync complete. Assigned ${totalUpdatedLeads} leads and ${totalUpdatedTasks} tasks.`
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});

// משימה מתוזמנת מוסרת - השתמש ב-automation במקום