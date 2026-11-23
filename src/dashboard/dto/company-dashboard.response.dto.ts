import type { HrDashboardResponseDto } from './hr-dashboard.response.dto.js';

export interface CompanyFeedbackBreakdownDto {
  openTotal: number;
  issues: number;
  suggestions: number;
}

export interface CompanyGovernanceSummaryDto {
  activeTeamsCount: number;
  totalDepartments: number;
  departmentsWithHead: number;
  pendingReviewsCount: number;
}

export interface CompanyDashboardResponseDto extends HrDashboardResponseDto {
  governance: CompanyGovernanceSummaryDto;
  feedbackBreakdown: CompanyFeedbackBreakdownDto;
}
