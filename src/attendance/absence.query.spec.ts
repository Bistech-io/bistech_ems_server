import {
  buildAttendanceBoard,
  evaluateCheckInPunctuality,
  type OrgAttendanceSettings,
} from './absence.query.js';

const SETTINGS: OrgAttendanceSettings = {
  workStart: '09:00',
  graceMinutes: 15,
  workEnd: '18:00',
  weekendDays: [5, 6],
};

describe('evaluateCheckInPunctuality', () => {
  it('marks check-in at or before start + grace as present in org timezone', () => {
    const result = evaluateCheckInPunctuality(
      new Date('2026-11-18T03:10:00Z'),
      'Asia/Dhaka',
      SETTINGS,
    );

    expect(result).toEqual({
      workDate: '2026-11-18',
      status: 'present',
      lateMinutes: 0,
    });
  });

  it('marks check-in after start + grace as late with exact lateMinutes', () => {
    const result = evaluateCheckInPunctuality(
      new Date('2026-11-18T03:27:00Z'),
      'Asia/Dhaka',
      SETTINGS,
    );

    expect(result).toEqual({
      workDate: '2026-11-18',
      status: 'late',
      lateMinutes: 12,
    });
  });
});

describe('buildAttendanceBoard', () => {
  it('derives absence for past working days, excludes weekends/holidays, and marks today not_checked_in before workEnd', () => {
    const board = buildAttendanceBoard({
      now: new Date('2026-11-18T04:00:00Z'),
      timezone: 'Asia/Dhaka',
      settings: SETTINGS,
      from: '2026-11-13',
      to: '2026-11-18',
      joiningDate: '2026-11-01',
      exitDate: null,
      isEmployeeActive: true,
      holidayDates: new Set(['2026-11-16']),
      storedRows: [
        {
          id: 'rec-sun',
          workDate: new Date('2026-11-15T00:00:00Z'),
          checkInAt: new Date('2026-11-15T03:04:00Z'),
          status: 'present',
          source: 'web',
          lateMinutes: 0,
          note: null,
        },
      ],
      todayStoredRow: null,
    });

    expect(board.today.status).toBe('not_checked_in');
    expect(board.records).toHaveLength(2);
    expect(board.records[0]).toMatchObject({
      workDate: '2026-11-15',
      status: 'present',
      isDerived: false,
    });
    expect(board.records[1]).toMatchObject({
      workDate: '2026-11-17',
      status: 'absent',
      isDerived: true,
    });
    expect(board.summary).toEqual({
      presentDays: 1,
      lateDays: 0,
      absentDays: 1,
      expectedWorkingDays: 2,
      attendanceRatePercent: 50,
    });
  });

  it('marks today as absent once workEnd has passed with no record', () => {
    const board = buildAttendanceBoard({
      now: new Date('2026-11-18T13:00:00Z'),
      timezone: 'Asia/Dhaka',
      settings: SETTINGS,
      from: '2026-11-18',
      to: '2026-11-18',
      joiningDate: '2026-11-01',
      exitDate: null,
      isEmployeeActive: true,
      holidayDates: new Set(),
      storedRows: [],
      todayStoredRow: null,
    });

    expect(board.today.status).toBe('absent');
    expect(board.records).toHaveLength(1);
    expect(board.records[0].isDerived).toBe(true);
    expect(board.summary.absentDays).toBe(1);
    expect(board.summary.attendanceRatePercent).toBe(0);
  });
});
