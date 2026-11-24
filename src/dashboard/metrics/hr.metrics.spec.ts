import { computeHrDashboardMetrics } from './hr.metrics.js';

describe('computeHrDashboardMetrics', () => {
  it('computes workforce, joiners, department summary, today & monthly attendance, tasks, feedback, and audit logs', () => {
    // 2026-11-18 (Wed) at 10:00 Asia/Dhaka (04:00Z) - before 18:00 workEnd
    const now = new Date('2026-11-18T04:00:00Z');

    const result = computeHrDashboardMetrics({
      now,
      timezone: 'Asia/Dhaka',
      settings: {
        workStart: '09:00',
        graceMinutes: 15,
        workEnd: '18:00',
        weekendDays: [5, 6],
      },
      departments: [
        { id: 'dept-eng', name: 'Engineering' },
        { id: 'dept-hr', name: 'Human Resources' },
      ],
      employees: [
        {
          id: 'emp-1',
          employeeCode: 'BST-1001',
          firstName: 'Nadia',
          lastName: 'Rahman',
          employmentStatus: 'active',
          joiningDate: new Date('2026-11-16T00:00:00Z'),
          exitDate: null,
          departmentId: 'dept-hr',
          departmentName: 'Human Resources',
          designationTitle: 'HR Manager',
        },
        {
          id: 'emp-2',
          employeeCode: 'BST-1002',
          firstName: 'Farhan',
          lastName: 'Ahmed',
          employmentStatus: 'active',
          joiningDate: new Date('2026-11-16T00:00:00Z'),
          exitDate: null,
          departmentId: 'dept-eng',
          departmentName: 'Engineering',
          designationTitle: 'Lead Engineer',
        },
        {
          id: 'emp-3',
          employeeCode: 'BST-1003',
          firstName: 'Former',
          lastName: 'Member',
          employmentStatus: 'inactive',
          joiningDate: new Date('2025-01-01T00:00:00Z'),
          exitDate: new Date('2026-10-31T00:00:00Z'),
          departmentId: 'dept-eng',
          departmentName: 'Engineering',
          designationTitle: 'Software Engineer',
        },
      ],
      holidayDates: [],
      monthAttendanceRows: [
        {
          id: 'att-1',
          employeeId: 'emp-1',
          workDate: new Date('2026-11-18T00:00:00Z'),
          checkInAt: new Date('2026-11-18T03:00:00Z'),
          status: 'present',
          source: 'web',
          lateMinutes: 0,
          note: null,
        },
        {
          id: 'att-2',
          employeeId: 'emp-2',
          workDate: new Date('2026-11-18T00:00:00Z'),
          checkInAt: new Date('2026-11-18T03:30:00Z'),
          status: 'late',
          source: 'web',
          lateMinutes: 15,
          note: null,
        },
      ],
      firstCheckInByEmployee: new Map([
        ['emp-1', new Date('2026-11-16T00:00:00Z')],
        ['emp-2', new Date('2026-11-16T00:00:00Z')],
      ]),
      taskAssignments: [
        { status: 'todo', dueDate: new Date('2026-11-17T00:00:00Z') }, // overdue
        { status: 'in_progress', dueDate: new Date('2026-11-20T00:00:00Z') }, // due soon
        { status: 'done', dueDate: new Date('2026-11-16T00:00:00Z') },
        { status: 'cancelled', dueDate: new Date('2026-11-16T00:00:00Z') },
      ],
      openFeedbackCount: 4,
      auditLogs: [
        {
          id: 'aud-1',
          action: 'employee.created',
          entityType: 'employee',
          entityId: 'emp-2',
          actorName: 'Nadia Rahman',
          createdAt: new Date('2026-11-16T05:00:00Z'),
        },
      ],
    });

    expect(result.workforce).toEqual({
      activeEmployees: 2,
      inactiveEmployees: 1,
      joinersThisMonth: 2,
      departmentSummary: [
        { departmentId: 'dept-eng', departmentName: 'Engineering', activeCount: 1 },
        { departmentId: 'dept-hr', departmentName: 'Human Resources', activeCount: 1 },
      ],
    });

    expect(result.todayAttendance).toEqual({
      workDate: '2026-11-18',
      isWorkingDay: true,
      presentCount: 1,
      lateCount: 1,
      notCheckedInCount: 0,
      absentCount: 0,
      attendanceRatePercent: 100,
    });

    // Nov 16 & Nov 17 were derived absent for both emp-1 and emp-2 (4 absent), plus 2 attended today (Nov 18) = 6 expected
    expect(result.monthlyAttendance).toEqual({
      presentDays: 1,
      lateDays: 1,
      absentDays: 4,
      expectedWorkingDays: 6,
      attendanceRatePercent: 33.3,
    });

    expect(result.tasks).toEqual({
      countsByStatus: {
        todo: 1,
        inProgress: 1,
        inReview: 0,
        changesRequested: 0,
        done: 1,
      },
      openCount: 2,
      overdueCount: 1,
      dueSoonCount: 1,
      completionRatePercent: 33,
    });

    expect(result.openFeedbackCount).toBe(4);
    expect(result.recentJoiners).toHaveLength(2);
    expect(result.recentAuditLogs).toHaveLength(1);
  });
});
