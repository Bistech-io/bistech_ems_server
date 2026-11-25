export const DEPT_HEAD_ROLE_NAMES = ['dept_head', 'department_head'] as const;

export function isDepartmentHeadRoleName(name: string): boolean {
  return name === 'dept_head' || name === 'department_head';
}

export function isDepartmentHeadRole(roles: readonly string[]): boolean {
  return roles.some((role) => isDepartmentHeadRoleName(role));
}
