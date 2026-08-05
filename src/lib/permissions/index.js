/**
 * Permissions — one import surface for the whole system.
 *
 *   import { can } from '@/lib/permissions';
 *   if (!can(user, 'finance.view')) return <NoAccess />;
 *
 * Layout:
 *   roles.js     — the four access levels and the legacy-role mapping
 *   catalog.js   — every permission there is, grouped and nested
 *   baselines.js — what each permission already resolves to today
 *   resolve.js   — the decision engine
 */

export * from './roles';
export * from './catalog';
export * from './baselines';
export * from './resolve';
export * from './pages';
