import type { CompanyDashboardResponseDto } from '../dto/company-dashboard.response.dto.js';
import {
  computeHrDashboardMetrics,
  type ComputeHrDashboardInput,
} from './hr.metrics.js';

export interface ComputeCompanyDashboardInput extends ComputeHrDashboardInput {
  activeTeamsCount: number;
  departmentsWithHead: number;
  pendingReviewsCount: number;
  openIssuesCount: number;
  openSuggestionsCount: number;
}

/**
 * Computes Company Dashboard metrics for Super Admin per FSD section 6,
 * reusing HR org-wide metrics and adding governance & review queue figures.
 */
export function computeCompanyDashboardMetrics(
  input: ComputeCompanyDashboardInput,
): CompanyDashboardResponseDto {
  const hrMetrics = computeHrDashboardMetrics(input);

  return {
    ...hrMetrics,
    governance: {
      activeTeamsCount: input.activeTeamsCount,
      totalDepartments: input.departments.length,
      departmentsWithHead: input.departmentsWithHead,
      pendingReviewsCount: input.pendingReviewsCount,
    },
    feedbackBreakdown: {
      openTotal: input.openFeedbackCount,
      issues: input.openIssuesCount,
      suggestions: input.openSuggestionsCount,
    },
  };
}
