import { computeEmployeeDashboardMetrics } from './employee.metrics.js';

describe('computeEmployeeDashboardMetrics', () => {
  it('aggregates attendance, task counts, overdue, due soon, completion rate, and feedback', () => {
    const now = new Date('2026-11-18T04:00:00Z'); // 10:00 Asia/Dhaka (Wed)

    const result = computeEmployeeDashboardMetrics({
      now,
      profile: {
        id: 'emp-1',
        employeeCode: 'BST-00142',
        firstName: 'Nadia',
        lastName: 'Rahman',
        workEmail: 'nadia@bistech.io',
        employmentStatus: 'active',
        joiningDate: new Date('2026-11-15T00:00:00Z'),
        exitDate: null,
        departmentName: 'Engineering',
        designationTitle: 'Senior Frontend Engineer',
        teamNames: ['Core Platform Squad'],
        timezone: 'Asia/Dhaka',
        settings: {
          workStart: '09:00',
          graceMinutes: 15,
          workEnd: '18:00',
          weekendDays: [5, 6],
        },
      },
      holidayDates: [],
      monthAttendanceRows: [
        {
          id: 'att-1',
          workDate: new Date('2026-11-15T00:00:00Z'),
          checkInAt: new Date('2026-11-15T03:00:00Z'),
          status: 'present',
          source: 'web',
          lateMinutes: 0,
          note: null,
        },
        {
          id: 'att-2',
          workDate: new Date('2026-11-16T00:00:00Z'),
          checkInAt: new Date('2026-11-16T03:27:00Z'),
          status: 'late',
          source: 'web',
          lateMinutes: 12,
          note: null,
        },
      ],
      todayAttendanceRow: null,
      taskAssignments: [
        {
          id: 'asg-1',
          taskId: 'tsk-1',
          status: 'in_progress',
          title: 'Overdue task',
          priority: 'urgent',
          assignmentType: 'team',
          dueDate: new Date('2026-11-17T00:00:00Z'),
          teamName: 'Core Platform Squad',
          departmentName: 'Engineering',
        },
        {
          id: 'asg-2',
          taskId: 'tsk-2',
          status: 'todo',
          title: 'Due soon task',
          priority: 'high',
          assignmentType: 'individual',
          dueDate: new Date('2026-11-20T00:00:00Z'),
          teamName: null,
          departmentName: 'Engineering',
        },
        {
          id: 'asg-3',
          taskId: 'tsk-3',
          status: 'done',
          title: 'Completed task',
          priority: 'low',
          assignmentType: 'self',
          dueDate: new Date('2026-11-16T00:00:00Z'),
          teamName: null,
          departmentName: 'Engineering',
        },
        {
          id: 'asg-4',
          taskId: 'tsk-4',
          status: 'cancelled',
          title: 'Cancelled task',
          priority: 'low',
          assignmentType: 'self',
          dueDate: new Date('2026-11-16T00:00:00Z'),
          teamName: null,
          departmentName: 'Engineering',
        },
      ],
      openFeedbackCount: 2,
      notifications: [
        {
          id: 'notif-1',
          type: 'task.assigned',
          title: 'New task assigned',
          body: 'Due soon task',
          readAt: null,
          createdAt: new Date('2026-11-18T03:00:00Z'),
        },
      ],
    });

    expect(result.employee).toMatchObject({
      employeeCode: 'BST-00142',
      fullName: 'Nadia Rahman',
      department: 'Engineering',
      teams: ['Core Platform Squad'],
    });
    expect(result.todayAttendance.status).toBe('not_checked_in');
    expect(result.monthlyAttendance).toEqual({
      presentDays: 1,
      lateDays: 1,
      absentDays: 1, // Nov 17 derived absent
      expectedWorkingDays: 3,
      attendanceRatePercent: 66.7,
    });
    expect(result.tasks.countsByStatus).toEqual({
      todo: 1,
      inProgress: 1,
      inReview: 0,
      changesRequested: 0,
      done: 1,
    });
    expect(result.tasks.openCount).toBe(2);
    expect(result.tasks.overdueCount).toBe(1);
    expect(result.tasks.dueSoonCount).toBe(1);
    expect(result.tasks.completionRatePercent).toBe(33);
    expect(result.tasks.items).toHaveLength(3); // cancelled excluded
    expect(result.openFeedbackCount).toBe(2);
    expect(result.recentNotifications).toHaveLength(1);
  });
});
