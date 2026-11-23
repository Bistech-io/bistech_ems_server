import { computeCompanyDashboardMetrics } from './company.metrics.js';

describe('computeCompanyDashboardMetrics', () => {
  it('computes company governance and feedback breakdown on top of org-wide metrics', () => {
    const result = computeCompanyDashboardMetrics({
      now: new Date('2026-11-18T04:00:00Z'),
      timezone: 'Asia/Dhaka',
      settings: {
        workStart: '09:00',
        graceMinutes: 15,
        workEnd: '18:00',
        weekendDays: [5, 6],
      },
      departments: [
        { id: 'dept-1', name: 'Engineering' },
        { id: 'dept-2', name: 'Human Resources' },
      ],
      employees: [],
      holidayDates: [],
      monthAttendanceRows: [],
      taskAssignments: [],
      openFeedbackCount: 5,
      auditLogs: [],
      activeTeamsCount: 3,
      departmentsWithHead: 1,
      pendingReviewsCount: 7,
      openIssuesCount: 2,
      openSuggestionsCount: 3,
    });

    expect(result.governance).toEqual({
      activeTeamsCount: 3,
      totalDepartments: 2,
      departmentsWithHead: 1,
      pendingReviewsCount: 7,
    });
    expect(result.feedbackBreakdown).toEqual({
      openTotal: 5,
      issues: 2,
      suggestions: 3,
    });
  });
});
