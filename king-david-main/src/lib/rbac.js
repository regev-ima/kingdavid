export const USER_SCOPES = {
  ADMIN: 'admin',
  SALES: 'sales_user',
  FACTORY: 'factory_user',
  ANON: 'anonymous',
};

export function getUserScope(user) {
  if (!user) return USER_SCOPES.ANON;
  if (user.role === 'admin') return USER_SCOPES.ADMIN;
  if (user.department === 'factory' || user.role === 'factory_user') return USER_SCOPES.FACTORY;
  return USER_SCOPES.SALES;
}

export function isAdmin(user) {
  return getUserScope(user) === USER_SCOPES.ADMIN;
}

export function isSalesUser(user) {
  return getUserScope(user) === USER_SCOPES.SALES;
}

export function isFactoryUser(user) {
  return getUserScope(user) === USER_SCOPES.FACTORY;
}

export function canAccessSalesWorkspace(user) {
  return isAdmin(user) || isSalesUser(user);
}

export function canAccessFactoryWorkspace(user) {
  return isAdmin(user) || isFactoryUser(user);
}

export function canAccessSupportWorkspace(user) {
  return isAdmin(user) || isFactoryUser(user) || isSalesUser(user);
}

export function canAccessReturnsWorkspace(user) {
  return canAccessSupportWorkspace(user);
}

export function canAccessAdminOnly(user) {
  return isAdmin(user);
}

function normalized(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizedIdentifierCandidates(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizedIdentifierCandidates(item));
  }

  if (typeof value === 'string') {
    const normalizedValue = normalized(value);
    if (!normalizedValue) return [];

    const localPart = normalizedValue.includes('@') ? normalizedValue.split('@')[0] : '';
    const compact = normalizedValue.replace(/\s+/g, '');
    return [normalizedValue, localPart, compact].filter(Boolean);
  }

  if (typeof value === 'object') {
    return [
      ...normalizedIdentifierCandidates(value.email),
      ...normalizedIdentifierCandidates(value.id),
      ...normalizedIdentifierCandidates(value.full_name),
      ...normalizedIdentifierCandidates(value.name),
      ...normalizedIdentifierCandidates(value.username),
    ];
  }

  return [];
}

export function matchesUserIdentifier(user, ...values) {
  const userCandidates = new Set([
    ...normalizedIdentifierCandidates(user?.email),
    ...normalizedIdentifierCandidates(user?.id),
    ...normalizedIdentifierCandidates(user?.full_name),
    ...normalizedIdentifierCandidates(user?.name),
  ]);

  return values.some((value) => {
    const candidates = normalizedIdentifierCandidates(value);
    return candidates.some((candidate) => userCandidates.has(candidate));
  });
}

export function canViewLead(user, lead) {
  if (!lead || !canAccessSalesWorkspace(user)) return false;
  if (isAdmin(user)) return true;
  return matchesUserIdentifier(user, lead.rep1, lead.rep2, lead.pending_rep_email);
}

export function filterLeadsForUser(user, leads = []) {
  return leads.filter((lead) => canViewLead(user, lead));
}

export function canViewSalesTask(user, task) {
  if (!task || !canAccessSalesWorkspace(user)) return false;
  if (isAdmin(user)) return true;

  if (
    matchesUserIdentifier(
      user,
      task.rep1,
      task.rep2,
      task.pending_rep_email,
      task.assigned_to,
      task.owner
    )
  ) {
    return true;
  }
  return false;
}

export function filterSalesTasksForUser(user, tasks = [], leadsById = {}) {
  return tasks.filter((task) => {
    if (!task) return false;
    if (canViewSalesTask(user, task)) return true;

    const hasExplicitOwnership = Boolean(
      normalized(task.rep1) ||
      normalized(task.rep2) ||
      normalized(task.pending_rep_email) ||
      normalized(task.assigned_to) ||
      normalized(task.owner)
    );

    if (hasExplicitOwnership || !task.lead_id) return false;

    const lead = leadsById[task.lead_id];
    return lead ? canViewLead(user, lead) : false;
  });
}

export function canViewOrder(user, order) {
  if (!order) return false;
  if (isAdmin(user) || isFactoryUser(user)) return true;
  if (!isSalesUser(user)) return false;
  return matchesUserIdentifier(user, order.rep1, order.rep2);
}

export function filterOrdersForUser(user, orders = []) {
  return orders.filter((order) => canViewOrder(user, order));
}

export function canViewQuote(user, quote, leadsById = {}) {
  if (!quote || !canAccessSalesWorkspace(user)) return false;
  if (isAdmin(user)) return true;
  if (matchesUserIdentifier(user, quote.created_by_rep)) return true;

  const lead = quote.lead_id ? leadsById[quote.lead_id] : null;
  return lead ? canViewLead(user, lead) : false;
}

export function filterQuotesForUser(user, quotes = [], leadsById = {}) {
  return quotes.filter((quote) => canViewQuote(user, quote, leadsById));
}

export function buildOrdersByCustomerId(orders = []) {
  return orders.reduce((acc, order) => {
    if (!order.customer_id) return acc;
    if (!acc[order.customer_id]) acc[order.customer_id] = [];
    acc[order.customer_id].push(order);
    return acc;
  }, {});
}

export function buildLeadsById(leads = []) {
  return leads.reduce((acc, lead) => {
    if (lead?.id) acc[lead.id] = lead;
    return acc;
  }, {});
}

export function canViewCustomer(user, customer, context = {}) {
  if (!customer || !canAccessSalesWorkspace(user)) return false;
  if (isAdmin(user)) return true;

  const { leadsById = {}, ordersByCustomerId = {} } = context;
  if (matchesUserIdentifier(user, customer.account_manager, customer.pending_rep_email)) return true;

  const lead = customer.lead_id ? leadsById[customer.lead_id] : null;
  if (lead && canViewLead(user, lead)) return true;

  const customerOrders = ordersByCustomerId[customer.id] || [];
  return customerOrders.some((order) => canViewOrder(user, order));
}

export function filterCustomersForUser(user, customers = [], context = {}) {
  return customers.filter((customer) => canViewCustomer(user, customer, context));
}

export function canViewSupportTicket(user, ticket) {
  if (!ticket || !canAccessSupportWorkspace(user)) return false;
  if (isAdmin(user) || isFactoryUser(user)) return true;
  return matchesUserIdentifier(user, ticket.assigned_to);
}

export function filterTicketsForUser(user, tickets = []) {
  return tickets.filter((ticket) => canViewSupportTicket(user, ticket));
}

export function canViewReturnRequest(user, returnRequest) {
  if (!returnRequest) return false;
  return canAccessReturnsWorkspace(user);
}

export function filterReturnsForUser(user, returnRequests = []) {
  return returnRequests.filter((returnRequest) => canViewReturnRequest(user, returnRequest));
}