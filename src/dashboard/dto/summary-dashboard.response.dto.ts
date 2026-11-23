import type { CompanyDashboardResponseDto } from './company-dashboard.response.dto.js';
import type { EmployeeDashboardResponseDto } from './employee-dashboard.response.dto.js';
import type { HrDashboardResponseDto } from './hr-dashboard.response.dto.js';

export type DashboardRoleView = 'company' | 'hr' | 'team' | 'me';

export interface SummaryDashboardResponseDto {
  primaryRole: 'super_admin' | 'hr_manager' | 'department_head' | 'employee';
  availableViews: DashboardRoleView[];
  company: CompanyDashboardResponseDto | null;
  hr: HrDashboardResponseDto | null;
  me: EmployeeDashboardResponseDto | null;
}
