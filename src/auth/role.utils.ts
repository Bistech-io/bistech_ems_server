export const DEPT_HEAD_ROLE_NAMES = ['dept_head', 'department_head'] as const;

const ROLE_PRIORITY: Record<string, number> = {
  super_admin: 4,
  hr_manager: 3,
  dept_head: 2,
  department_head: 2,
  employee: 1,
};

export function isDepartmentHeadRoleName(name: string): boolean {
  return name === 'dept_head' || name === 'department_head';
}

export function isDepartmentHeadRole(roles: readonly string[]): boolean {
  return roles.some((role) => isDepartmentHeadRoleName(role));
}

export function getRolePriority(role: string): number {
  return ROLE_PRIORITY[role] ?? 0;
}

export function sortRolesByPriority(roles: readonly string[]): string[] {
  return Array.from(new Set(roles)).sort(
    (a, b) => getRolePriority(b) - getRolePriority(a),
  );
}
