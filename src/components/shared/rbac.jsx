/**
 * Role-Based Access Control helpers for the sales/factory workspace.
 */

export function buildLeadsById(leads) {
  const map = {};
  for (const lead of leads) {
    if (lead?.id) map[lead.id] = lead;
  }
  return map;
}

export function isAdmin(user) {
  return user?.role === 'admin';
}

export function isFactoryUser(user) {
  return user?.department === 'factory' || user?.role === 'factory_user';
}

export function isBookkeeperUser(user) {
  return user?.department === 'bookkeeping' || user?.role === 'bookkeeper';
}

export function canAccessSalesWorkspace(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (isFactoryUser(user)) return false;
  if (isBookkeeperUser(user)) return false;
  return true;
}

export function canAccessBookkeepingWorkspace(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return isBookkeeperUser(user);
}

function taskBelongsToUser(user, task, leadsById) {
  if (!user || !task) return false;
  if (user.role === 'admin') return true;
  const email = user.email?.toLowerCase();
  if (!email) return false;
  if (task.rep1?.toLowerCase() === email) return true;
  if (task.rep2?.toLowerCase() === email) return true;
  if (task.created_by?.toLowerCase() === email) return true;
  if (task.pending_rep_email?.toLowerCase() === email) return true;
  if (task.lead_id && leadsById) {
    const lead = leadsById[task.lead_id];
    if (lead) {
      if (lead.rep1?.toLowerCase() === email) return true;
      if (lead.rep2?.toLowerCase() === email) return true;
      if (lead.pending_rep_email?.toLowerCase() === email) return true;
    }
  }
  return false;
}

export function filterSalesTasksForUser(user, allTasks, leadsById) {
  if (!user || !allTasks) return [];
  if (user.role === 'admin') return allTasks;
  // Non-admin reps never see assignment tasks — those belong to the
  // manager queue. Stripping them at the canonical filter means every
  // surface that calls this helper (Dashboard widgets, SalesTasks list,
  // KPI counts) automatically excludes them.
  return allTasks.filter(
    (task) => task?.task_type !== 'assignment' && taskBelongsToUser(user, task, leadsById),
  );
}

export function filterLeadsForUser(user, leads) {
  if (!user || !leads) return [];
  if (user.role === 'admin') return leads;
  const email = user.email?.toLowerCase();
  if (!email) return [];
  return leads.filter((lead) => {
    if (lead.rep1?.toLowerCase() === email) return true;
    if (lead.rep2?.toLowerCase() === email) return true;
    if (lead.pending_rep_email?.toLowerCase() === email) return true;
    if (lead.created_by?.toLowerCase() === email) return true;
    return false;
  });
}

export function canViewLead(user, lead) {
  if (!user || !lead) return false;
  if (user.role === 'admin') return true;
  const email = user.email?.toLowerCase();
  if (!email) return false;
  if (lead.rep1?.toLowerCase() === email) return true;
  if (lead.rep2?.toLowerCase() === email) return true;
  if (lead.pending_rep_email?.toLowerCase() === email) return true;
  return false;
}