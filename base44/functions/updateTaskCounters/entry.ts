import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));

    // Helper: Compute Israel Date String (YYYY-MM-DD)
    const getIsraelDateStr = (date) => {
      if (!date || isNaN(date.getTime())) return null;
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jerusalem',
        year: 'numeric', month: 'numeric', day: 'numeric'
      });
      const p = formatter.formatToParts(date);
      const y = p.find(x => x.type === 'year').value;
      const m = p.find(x => x.type === 'month').value.padStart(2, '0');
      const d = p.find(x => x.type === 'day').value.padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    // Helper: Get Today's Israel Date String
    const getTodayStr = () => getIsraelDateStr(new Date());

    // Helper: Analyze a task to get its bucket flags
    const analyzeTask = (task, todayStr) => {
        if (!task) return { total: 0, completed: 0, not_completed: 0, today: 0, overdue: 0, upcoming: 0 };
        
        const isCompleted = task.task_status === 'completed';
        let dueDate = null;
        if (task.due_date) {
            dueDate = new Date(task.due_date);
            if (isNaN(dueDate.getTime()) && typeof task.due_date === 'string') {
                 // Try parsing DD/MM/YYYY HH:MM
                 const matchTime = task.due_date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})$/);
                 if (matchTime) {
                   const [, day, month, year, hour, minute] = matchTime;
                   dueDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00`);
                 } else {
                   const matchDate = task.due_date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                   if (matchDate) {
                     const [, day, month, year] = matchDate;
                     dueDate = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
                   }
                 }
            }
        }

        const isValidDate = dueDate && !isNaN(dueDate.getTime());
        const taskDateStr = isValidDate ? getIsraelDateStr(dueDate) : null;
        
        let isToday = false;
        let isOverdue = false;
        let isUpcoming = false;

        if (isValidDate && !isCompleted) {
            if (taskDateStr === todayStr) isToday = true;
            else if (taskDateStr < todayStr) isOverdue = true;
            else if (taskDateStr > todayStr) isUpcoming = true;
        }

        return {
            total: 1,
            completed: isCompleted ? 1 : 0,
            not_completed: isCompleted ? 0 : 1,
            today: isToday ? 1 : 0,
            overdue: isOverdue ? 1 : 0,
            upcoming: isUpcoming ? 1 : 0
        };
    };

    // --- INCREMENTAL UPDATE (Entity Automation) ---
    if (body.event) {
        const { event, data, old_data } = body;
        // Skip if payload too large (data missing) - we can't do accurate incremental update easily
        if (!data && event.type !== 'delete') {
            console.log("Payload too large or missing data, skipping incremental update");
            return Response.json({ status: 'skipped' });
        }

        const todayStr = getTodayStr();
        const changes = {}; // key -> delta

        const addChange = (key, rep, delta) => {
            if (delta === 0) return;
            // Global
            changes[`${key}__`] = (changes[`${key}__`] || 0) + delta;
            // Rep
            if (rep) {
                changes[`${key}__${rep}`] = (changes[`${key}__${rep}`] || 0) + delta;
            }
        };

        const processState = (taskState, multiplier) => {
            if (!taskState) return;
            const flags = analyzeTask(taskState, todayStr);
            const reps = [taskState.rep1, taskState.rep2, taskState.pending_rep_email].filter(Boolean);
            
            // Global counters
            addChange('total', null, flags.total * multiplier);
            addChange('completed', null, flags.completed * multiplier);
            addChange('not_completed', null, flags.not_completed * multiplier);
            addChange('today', null, flags.today * multiplier);
            addChange('overdue', null, flags.overdue * multiplier);
            addChange('upcoming', null, flags.upcoming * multiplier);

            // Rep counters
            reps.forEach(rep => {
                addChange('total', rep, flags.total * multiplier);
                addChange('completed', rep, flags.completed * multiplier);
                addChange('not_completed', rep, flags.not_completed * multiplier);
                addChange('today', rep, flags.today * multiplier);
                addChange('overdue', rep, flags.overdue * multiplier);
                addChange('upcoming', rep, flags.upcoming * multiplier);
            });
        };

        if (event.type === 'create') {
            processState(data, 1);
        } else if (event.type === 'delete') {
            // For delete, we need the data. if deleted, `data` might be the deleted object or null?
            // Usually `data` is the object.
            processState(data || old_data, -1);
        } else if (event.type === 'update') {
            if (old_data) {
                processState(old_data, -1);
                processState(data, 1);
            } else {
                // If we don't have old_data (e.g. payload too large), we can't do accurate delta.
                // Fallback: maybe just re-process 'data' as if it's new? No, that would double count.
                // Ideally we should fetch the old entity, but we can't go back in time.
                console.log("Missing old_data for update, skipping incremental update");
                return Response.json({ status: 'skipped_missing_old_data' });
            }
        }

        // Apply changes to DB
        for (const [compositeKey, delta] of Object.entries(changes)) {
            if (delta === 0) continue;
            const [key, rep] = compositeKey.split('__');
            
            // Find existing counter
            let query = { counter_key: key };
            if (rep) query.rep_email = rep;
            else query.rep_email = { "$in": [null, ""] }; // Empty string or null for global

            // We can't query with $in for null/empty efficiently in one go if schema differs.
            // Simplified: list with filter.
            const filter = { counter_key: key };
            if (rep) filter.rep_email = rep;
            // For global, we check where rep_email is empty/null. SDK filter might be tricky.
            // Let's assume rep_email is "" for global based on my full scan logic.
            
            // Actually, best to just search by key and filter in memory if needed, but inefficient.
            // Let's rely on rep_email being "" for global.
            if (!rep) filter.rep_email = ""; 

            const existing = await base44.asServiceRole.entities.TaskCounter.list(null, 1, 0, { filter });
            // Note: list(sort, limit, skip, options) or list(sort, limit, skip) - check SDK.
            // SDK usage: list(sort, limit, skip) or filter(query, sort, limit, skip)
            
            const matches = await base44.asServiceRole.entities.TaskCounter.filter(filter, '-created_date', 1);
            
            if (matches.length > 0) {
                const counter = matches[0];
                const newCount = (counter.count || 0) + delta;
                await base44.asServiceRole.entities.TaskCounter.update(counter.id, { count: newCount });
            } else {
                if (delta > 0) {
                    await base44.asServiceRole.entities.TaskCounter.create({
                        counter_key: key,
                        count: delta,
                        rep_email: rep || ""
                    });
                }
            }
        }
        
        return Response.json({ status: 'incremental_success', changes });
    }

    // --- FULL SCAN MODE (Phase 1 & 2) ---
    const phase = body.phase || 'collect';
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    if (phase === 'collect') {
      const startSkip = body.startSkip || 0;
      const prevCounters = body.prevCounters || { total: 0, completed: 0, not_completed: 0, today: 0, overdue: 0, upcoming: 0 };
      const prevRepCounters = body.prevRepCounters || {};

      const limit = 200;
      let skip = startSkip;
      const startTime = Date.now();
      const MAX_TIME = 140000;
      const todayStr = getTodayStr();

      const counters = { ...prevCounters };
      const repCounters = {};
      for (const [k, v] of Object.entries(prevRepCounters)) {
        repCounters[k] = { ...v };
      }

      while (true) {
        if (Date.now() - startTime > MAX_TIME) {
          return Response.json({
            status: 'continue',
            nextSkip: skip,
            counters,
            repCounters,
          });
        }

        const batch = await base44.asServiceRole.entities.SalesTask.list('-created_date', limit, skip);

        for (const task of batch) {
          const flags = analyzeTask(task, todayStr);

          // Update batch totals
          counters.total += flags.total;
          counters.completed += flags.completed;
          counters.not_completed += flags.not_completed;
          counters.today += flags.today;
          counters.overdue += flags.overdue;
          counters.upcoming += flags.upcoming;

          const reps = [task.rep1, task.rep2, task.pending_rep_email].filter(Boolean);
          for (const rep of reps) {
            if (!repCounters[rep]) {
              repCounters[rep] = { total: 0, completed: 0, not_completed: 0, today: 0, overdue: 0, upcoming: 0 };
            }
            repCounters[rep].total += flags.total;
            repCounters[rep].completed += flags.completed;
            repCounters[rep].not_completed += flags.not_completed;
            repCounters[rep].today += flags.today;
            repCounters[rep].overdue += flags.overdue;
            repCounters[rep].upcoming += flags.upcoming;
          }
        }

        if (batch.length < limit) {
          return Response.json({
            status: 'collected',
            counters,
            repCounters,
          });
        }
        skip += limit;
        await delay(200);
      }
    }

    // PHASE 2: Save counters to DB
    if (phase === 'save') {
      const { counters, repCounters } = body;
      
      // ... (Existing save logic, simplified for brevity but functional)
      // Note: Re-implementing save logic to be safe
      const existingCounters = [];
      let cSkip = 0;
      while (true) {
        const cBatch = await base44.asServiceRole.entities.TaskCounter.list('-created_date', 200, cSkip);
        existingCounters.push(...cBatch);
        if (cBatch.length < 200) break;
        cSkip += 200;
        await delay(500);
      }

      const existingMap = {};
      for (const c of existingCounters) {
        existingMap[`${c.counter_key}__${c.rep_email || ''}`] = c;
      }

      const toCreate = [];
      const toUpdate = [];
      const touchedIds = new Set();

      const prepareUpdate = (key, count, rep) => {
          const mapKey = `${key}__${rep || ''}`;
          if (existingMap[mapKey]) {
              touchedIds.add(existingMap[mapKey].id);
              if (existingMap[mapKey].count !== count) {
                  toUpdate.push({ id: existingMap[mapKey].id, data: { count } });
              }
          } else {
              toCreate.push({ counter_key: key, count, rep_email: rep || "" });
          }
      };

      for (const [key, count] of Object.entries(counters)) {
          prepareUpdate(key, count, null);
      }

      for (const [rep, repData] of Object.entries(repCounters)) {
          for (const [key, count] of Object.entries(repData)) {
              prepareUpdate(key, count, rep);
          }
      }

      // Bulk Create
      if (toCreate.length > 0) {
        for (let i = 0; i < toCreate.length; i += 50) {
          await base44.asServiceRole.entities.TaskCounter.bulkCreate(toCreate.slice(i, i + 50));
          await delay(500);
        }
      }

      // Update
      for (let i = 0; i < toUpdate.length; i++) {
        await base44.asServiceRole.entities.TaskCounter.update(toUpdate[i].id, toUpdate[i].data);
        if (i > 0 && i % 20 === 0) await delay(500);
      }

      // Delete stale
      const staleIds = Object.values(existingMap).map(c => c.id).filter(id => !touchedIds.has(id));
      for (let i = 0; i < staleIds.length; i++) {
        await base44.asServiceRole.entities.TaskCounter.delete(staleIds[i]);
        if (i > 0 && i % 20 === 0) await delay(500);
      }

      return Response.json({
        success: true,
        stats: { created: toCreate.length, updated: toUpdate.length, deleted: staleIds.length }
      });
    }

    return Response.json({ error: 'Unknown phase' }, { status: 400 });

  } catch (error) {
    console.error('Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});