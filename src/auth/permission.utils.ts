import type { AuthenticatedUser } from './auth.guard.js';
import { isDepartmentHeadRoleName } from './role.utils.js';

export type ScopeLevel = 'own' | 'team' | 'department' | 'managed' | 'org';

export const SCOPE_RANKS: Record<ScopeLevel, number> = {
  own: 1,
  team: 2,
  department: 3,
  managed: 4,
  org: 5,
};

const ALL_ORG_PERMISSIONS: Record<string, ScopeLevel> = {
  'user.read': 'org',
  'user.manage': 'org',
  'role.manage': 'org',
  'audit.read': 'org',
  'org.settings.manage': 'org',
  'employee.read': 'org',
  'employee.read.sensitive': 'org',
  'employee.create': 'org',
  'employee.update': 'org',
  'employee.status.manage': 'org',
  'employee.history.read': 'org',
  'org.structure.read': 'org',
  'org.structure.manage': 'org',
  'department.head.assign': 'org',
  'attendance.self': 'own',
  'attendance.read': 'org',
  'attendance.correct': 'org',
  'task.create.self': 'own',
  'task.assign': 'org',
  'task.read': 'org',
  'task.board.team': 'org',
  'task.board.department': 'org',
  'task.work': 'own',
  'task.comment': 'org',
  'task.review': 'org',
  'task.manage': 'org',
  'team.read': 'org',
  'team.manage': 'org',
  'dashboard.read': 'org',
  'feedback.submit': 'own',
  'feedback.read': 'org',
  'feedback.manage': 'org',
};

/**
 * Fallback permission matrix used ONLY when a unit-test caller fixture omits
 * `caller.permissions`. Live HTTP requests populate `caller.permissions` from
 * `role_permissions` in AuthGuard.
 */
export const SYSTEM_ROLE_DEFAULT_PERMISSIONS: Record<
  string,
  Record<string, ScopeLevel>
> = {
  super_admin: ALL_ORG_PERMISSIONS,
  hr_manager: {
    'employee.read': 'org',
    'employee.read.sensitive': 'org',
    'employee.create': 'org',
    'employee.update': 'org',
    'employee.status.manage': 'org',
    'employee.history.read': 'org',
    'org.structure.read': 'org',
    'org.structure.manage': 'org',
    'org.settings.manage': 'org',
    'attendance.self': 'own',
    'attendance.read': 'org',
    'attendance.correct': 'org',
    'task.create.self': 'own',
    'task.read': 'org',
    'task.work': 'own',
    'task.comment': 'org',
    'team.read': 'org',
    'dashboard.read': 'org',
    'feedback.submit': 'own',
    'feedback.read': 'org',
    'feedback.manage': 'org',
  },
  dept_head: {
    'employee.read': 'department',
    'org.structure.read': 'org',
    'attendance.self': 'own',
    'attendance.read': 'department',
    'task.create.self': 'own',
    'task.assign': 'department',
    'task.read': 'department',
    'task.board.department': 'department',
    'task.work': 'own',
    'task.comment': 'department',
    'task.review': 'department',
    'task.manage': 'department',
    'team.read': 'department',
    'team.manage': 'department',
    'dashboard.read': 'department',
    'feedback.submit': 'own',
    'feedback.read': 'department',
  },
  employee: {
    'employee.read': 'own',
    'attendance.self': 'own',
    'task.create.self': 'own',
    'task.read': 'team',
    'task.board.team': 'team',
    'task.work': 'own',
    'task.comment': 'team',
    'team.read': 'team',
    'dashboard.read': 'own',
    'feedback.submit': 'own',
    'feedback.read': 'own',
  },
};

export function mergeRolePermissionGrants(
  grants: Array<{ permission: { key: string }; scope: string }>,
): Record<string, ScopeLevel> {
  const map: Record<string, ScopeLevel> = {};
  for (const rp of grants) {
    const scope = rp.scope as ScopeLevel;
    const newRank = SCOPE_RANKS[scope] ?? 0;
    const existingScope = map[rp.permission.key];
    const currentRank = existingScope ? SCOPE_RANKS[existingScope] ?? 0 : 0;
    if (newRank > currentRank) {
      map[rp.permission.key] = scope;
    }
  }
  return map;
}

export function resolveFallbackPermissionsForRoleNames(
  roles: readonly string[],
): Record<string, ScopeLevel> {
  const merged: Record<string, ScopeLevel> = {};
  for (const rawRole of roles) {
    const key = isDepartmentHeadRoleName(rawRole) ? 'dept_head' : rawRole;
    const roleGrants = SYSTEM_ROLE_DEFAULT_PERMISSIONS[key];
    if (!roleGrants) continue;
    for (const [permKey, scope] of Object.entries(roleGrants)) {
      const existing = merged[permKey];
      if (!existing || SCOPE_RANKS[scope] > SCOPE_RANKS[existing]) {
        merged[permKey] = scope;
      }
    }
  }
  return merged;
}

export function getEffectivePermissions(
  caller: Pick<AuthenticatedUser, 'roles' | 'permissions'>,
): Record<string, string> {
  if (caller.permissions !== undefined) {
    return caller.permissions;
  }
  return resolveFallbackPermissionsForRoleNames(caller.roles);
}

export function getGrantedScope(
  caller: Pick<AuthenticatedUser, 'roles' | 'permissions'>,
  permissionKey: string,
): ScopeLevel | null {
  if (caller.roles.includes('super_admin')) {
    const explicit = caller.permissions?.[permissionKey] as ScopeLevel | undefined;
    return explicit ?? 'org';
  }
  const perms = getEffectivePermissions(caller);
  const scope = perms[permissionKey] as ScopeLevel | undefined;
  return scope && SCOPE_RANKS[scope] ? scope : null;
}

export function hasPermission(
  caller: Pick<AuthenticatedUser, 'roles' | 'permissions'>,
  permissionKey: string,
  minScope: ScopeLevel = 'own',
): boolean {
  if (caller.roles.includes('super_admin')) {
    return true;
  }
  const granted = getGrantedScope(caller, permissionKey);
  if (!granted) return false;
  return (SCOPE_RANKS[granted] ?? 0) >= (SCOPE_RANKS[minScope] ?? 0);
}
