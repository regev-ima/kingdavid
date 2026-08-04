// Guards the promise the permissions system is built on: with nothing
// configured, every gate answers exactly what it answered before the system
// existed — and the new controls do only what they claim.
//
//   node scripts/check-permissions.mjs
//
// Exits non-zero on any failure.
//
// The modules under test import through the `@/` alias, which plain Node does
// not understand, so the script bundles itself with esbuild (already present
// as a Vite dependency) and runs the bundle. That keeps the source files in
// the codebase's normal import style instead of bending them around a test.

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const SUITE = String.raw`
import {
  can, explain, isExplicitlyBlocked, hydrateRolePermissions, resolveForLevel,
  getAccessLevel, canGrantAccessLevel, canDelegatePermission, canManagePermissions,
  ACCESS_LEVELS, PERMISSION_KEYS, getPermission, getAncestorKeys, getDescendantKeys,
  normalizeMatrix, normalizeOverrides,
} from '@/lib/permissions';
import {
  canAccessSalesWorkspace, canAccessFactoryWorkspace, canAccessBookkeepingWorkspace,
  canViewOrdersWorkspace, canViewFinanceWorkspace, canUseBulkUpdate, canEditSchedule,
  canManageService, canAccessSupportWorkspace, canAccessAdminOnly,
} from '@/lib/rbac';

let failures = 0;
const check = (name, actual, expected) => {
  if (actual === expected) { console.log('  ✓ ' + name); return; }
  failures++;
  console.log('  ✗ ' + name + ': got ' + actual + ', expected ' + expected);
};
const section = (t) => console.log('\n' + t);

const admin        = { id: '1',  email: 'a@x.co',  role: 'admin' };
const rep          = { id: '2',  email: 'r@x.co',  role: 'sales_user' };
const repFinance   = { id: '3',  email: 'f@x.co',  role: 'sales_user', extra_permissions: { view_finance: true } };
const repBulk      = { id: '4',  email: 'b@x.co',  role: 'sales_user', extra_permissions: { bulk_update: true } };
const repSchedule  = { id: '5',  email: 's@x.co',  role: 'sales_user', extra_permissions: { edit_schedule: true } };
const repAllLeads  = { id: '6',  email: 'al@x.co', role: 'sales_user', extra_permissions: { view_all_leads: true } };
const serviceMgr   = { id: '7',  email: 'sm@x.co', role: 'sales_user', can_manage_service: true };
const factory      = { id: '8',  email: 'fa@x.co', role: 'factory_user' };
const factoryDept  = { id: '9',  email: 'fd@x.co', role: 'user', department: 'factory' };
const bookkeeper   = { id: '10', email: 'bk@x.co', role: 'bookkeeper' };
const storeMgr     = { id: '11', email: 'st@x.co', role: 'sales_user', access_level: 'store_manager' };
const chiefMgr     = { id: '12', email: 'ch@x.co', role: 'sales_user', access_level: 'chief_manager' };
const superAdmin   = { id: '13', email: 'su@x.co', role: 'admin',      access_level: 'super_admin' };

// Every archetype whose role/department puts them on the sales floor.
// The per-rep grants (finance, bulk, schedule, all-leads, service) are all
// carried by sales users, so they belong here too.
const SALES = [rep, repFinance, repBulk, repSchedule, repAllLeads, serviceMgr];
const EVERYONE = [admin, ...SALES, factory, factoryDept, bookkeeper, superAdmin];

// Every composite gate in lib/rbac, and the exact set of archetypes it must
// admit. Transcribed from the pre-existing rules, not read off the new system —
// the point is to catch the new system disagreeing with them.
const LEGACY_TRUTH = [
  ['canAccessSalesWorkspace',       canAccessSalesWorkspace,       [admin, ...SALES]],
  ['canAccessFactoryWorkspace',     canAccessFactoryWorkspace,     [admin, factory, factoryDept]],
  ['canAccessBookkeepingWorkspace', canAccessBookkeepingWorkspace, [admin, bookkeeper]],
  ['canViewOrdersWorkspace',        canViewOrdersWorkspace,        [admin, ...SALES, bookkeeper]],
  ['canViewFinanceWorkspace',       canViewFinanceWorkspace,       [admin, bookkeeper, repFinance]],
  ['canUseBulkUpdate',              canUseBulkUpdate,              [admin, repBulk]],
  ['canEditSchedule',               canEditSchedule,               [admin, repSchedule]],
  ['canManageService',              canManageService,              [admin, serviceMgr]],
  ['canAccessSupportWorkspace',     canAccessSupportWorkspace,     [admin, ...SALES, factory, factoryDept]],
  ['canAccessAdminOnly',            canAccessAdminOnly,            [admin, superAdmin]],
];

section('── 1. Nothing configured → every legacy gate is unchanged ──');
hydrateRolePermissions({});
for (const [name, fn, allowed] of LEGACY_TRUTH) {
  const got = EVERYONE.filter(fn).map((u) => u.email).sort().join(',');
  const want = [...allowed, superAdmin].filter((u, i, a) => a.indexOf(u) === i)
    .map((u) => u.email).sort().join(',');
  check(name, got, want);
}

section('── 2. Nothing is hidden anywhere until a switch is thrown ──');
for (const u of EVERYONE) {
  check(u.email + ': 0 explicitly-blocked keys',
        PERMISSION_KEYS.filter((k) => isExplicitlyBlocked(u, k)).length, 0);
}

section('── 3. Settings: whole screen / one section / one sub-section ──');
hydrateRolePermissions({ rep: { 'settings.access': false } });
check('whole screen off', can(rep, 'settings.access'), false);
check('  … every child off with it',
      getDescendantKeys('settings.access').every((k) => !can(rep, k)), true);
check('  … and the reason names the ancestor',
      explain(rep, 'settings.profile.avatar').blockedBy, 'settings.access');
check('  … another level untouched', can(admin, 'settings.access'), true);

hydrateRolePermissions({ rep: { 'settings.statuses': false } });
check('one section off, screen still open', can(rep, 'settings.access'), true);
check('  … the section is off', can(rep, 'settings.statuses'), false);
check('  … its sub-sections too', can(rep, 'settings.statuses.colors'), false);
check('  … siblings untouched', can(rep, 'settings.profile'), true);

hydrateRolePermissions({ store_manager: { 'settings.users': true, 'settings.users.documents': false } });
check('sub-section off inside an open section', can(storeMgr, 'settings.users'), true);
check('  … the sub-section is off', can(storeMgr, 'settings.users.documents'), false);
check('  … its siblings are open', can(storeMgr, 'settings.users.details'), true);

section('── 4. A role-level "off" never revokes a per-rep grant ──');
hydrateRolePermissions({
  rep: { 'finance.view': false, 'settings.bulk': false, 'team.shift_schedule_edit': false, 'service.manage': false },
});
check('plain rep loses finance', can(rep, 'finance.view'), false);
check('rep holding the grant keeps finance', can(repFinance, 'finance.view'), true);
check('  … and bulk update', can(repBulk, 'settings.bulk'), true);
check('  … and shift editing', can(repSchedule, 'team.shift_schedule_edit'), true);
check('  … and service management', can(serviceMgr, 'service.manage'), true);
check('  … the source says why', explain(repFinance, 'finance.view').source, 'user_grant');

section('── 5. A per-user override is decisive, in both directions ──');
hydrateRolePermissions({});
const block = (u, key) => ({ ...u, permission_overrides: { [key]: false } });
const open  = (u, key) => ({ ...u, permission_overrides: { [key]: true } });
check('blocks a grant the rep holds', can(block(repFinance, 'finance.view'), 'finance.view'), false);
check('  … and the legacy gate honours it', canViewFinanceWorkspace(block(repFinance, 'finance.view')), false);
check('opens finance for one rep', canViewFinanceWorkspace(open(rep, 'finance.view')), true);
check('blocks bulk update', canUseBulkUpdate(block(repBulk, 'settings.bulk')), false);
check('blocks shift editing', canEditSchedule(block(repSchedule, 'team.shift_schedule_edit')), false);
check('blocks service management', canManageService(block(serviceMgr, 'service.manage')), false);
check('blocks the sales workspace', canAccessSalesWorkspace(block(rep, 'leads.view')), false);
check('blocks an admin too', canViewFinanceWorkspace(block(admin, 'finance.view')), false);
check('never blocks a super admin', canViewFinanceWorkspace(block(superAdmin, 'finance.view')), true);

section('── 6. Access levels ──');
hydrateRolePermissions({});
check('legacy admin infers מנהל ראשי', getAccessLevel(admin), ACCESS_LEVELS.CHIEF_MANAGER);
check('legacy rep infers נציג', getAccessLevel(rep), ACCESS_LEVELS.REP);
check('store manager sees all tasks', can(storeMgr, 'tasks.view_all'), true);
check('plain rep does not', can(rep, 'tasks.view_all'), false);
check('store manager has no profit data', can(storeMgr, 'finance.profit'), false);
check('chief manager does', can(chiefMgr, 'finance.profit'), true);
check('super admin holds every permission', PERMISSION_KEYS.every((k) => can(superAdmin, k)), true);

section('── 7. A tier default never crosses a workspace boundary ──');
check('factory user gets no leads', can(factory, 'leads.view'), false);
check('factory user by department gets no leads', can(factoryDept, 'leads.view'), false);
check('bookkeeper gets no leads', can(bookkeeper, 'leads.view'), false);
check('bookkeeper gets no service desk', can(bookkeeper, 'service.view'), false);
check('sales rep gets no factory', can(rep, 'factory.view'), false);
check('… but an explicit grant still opens it', can(open(factory, 'leads.view'), 'leads.view'), true);

section('── 8. Delegation guards ──');
check('chief may not appoint a peer', canGrantAccessLevel(chiefMgr, ACCESS_LEVELS.CHIEF_MANAGER), false);
check('chief may appoint a store manager', canGrantAccessLevel(chiefMgr, ACCESS_LEVELS.STORE_MANAGER), true);
check('chief may not appoint a super admin', canGrantAccessLevel(chiefMgr, ACCESS_LEVELS.SUPER_ADMIN), false);
check('super admin may', canGrantAccessLevel(superAdmin, ACCESS_LEVELS.SUPER_ADMIN), true);
check('store manager may not appoint at all', canGrantAccessLevel(storeMgr, ACCESS_LEVELS.REP), false);
check('cannot grant what you lack', canDelegatePermission(rep, 'finance.profit'), false);
check('can grant what you hold', canDelegatePermission(admin, 'leads.delete'), true);
check('admin cannot manage the matrix', canManagePermissions(admin), false);
check('… unless nobody is super admin yet', canManagePermissions(admin, { superAdminExists: false }), true);
check('a rep never can', canManagePermissions(rep, { superAdminExists: false }), false);
check('super admin always can', canManagePermissions(superAdmin), true);

section('── 9. Stored values are sanitised ──');
check('unknown level dropped', JSON.stringify(normalizeMatrix({ wizard: { 'leads.view': true } })), '{}');
check('unknown key dropped', JSON.stringify(normalizeMatrix({ rep: { 'not.a.key': true } })), '{}');
check('non-boolean dropped', JSON.stringify(normalizeMatrix({ rep: { 'leads.view': 'yes' } })), '{}');
check('valid entry kept', JSON.stringify(normalizeMatrix({ rep: { 'leads.view': false } })), '{"rep":{"leads.view":false}}');
check('overrides sanitised too', JSON.stringify(normalizeOverrides({ 'nope': true, 'leads.view': true })), '{"leads.view":true}');
check('unknown key is never allowed', can(admin, 'made.up.key'), false);

section('── 10. Catalog integrity ──');
check('every key resolves', PERMISSION_KEYS.every((k) => getPermission(k) !== null), true);
check('no duplicate keys', new Set(PERMISSION_KEYS).size, PERMISSION_KEYS.length);
check('every child key is prefixed by its parent',
      PERMISSION_KEYS.every((k) => getAncestorKeys(k).every((a) => k.startsWith(a.split('.')[0]))), true);
check('no cycles in the tree', PERMISSION_KEYS.every((k) => !getAncestorKeys(k).includes(k)), true);
console.log('  · ' + PERMISSION_KEYS.length + ' permissions in the catalog');

console.log(failures === 0 ? '\nAll checks passed.\n' : '\n' + failures + ' FAILED\n');
process.exit(failures === 0 ? 0 : 1);
`;

const dir = mkdtempSync(join(tmpdir(), 'permcheck-'));
const entry = join(dir, 'suite.mjs');
const out = join(dir, 'suite.bundle.mjs');
try {
  writeFileSync(entry, SUITE, 'utf8');
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
    alias: { '@': resolve(root, 'src') },
    logLevel: 'error',
  });
  await import(pathToFileURL(out).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
