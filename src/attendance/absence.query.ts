import type {
  AttendanceRecordDto,
  AttendanceRecordStatus,
  AttendanceSource,
  MonthlyAttendanceSummaryDto,
  TodayAttendanceDto,
} from './dto/attendance-board.response.dto.js';

export interface OrgAttendanceSettings {
  workStart: string;
  graceMinutes: number;
  workEnd: string;
  weekendDays: number[];
}

export interface StoredAttendanceRow {
  id: string;
  workDate: Date;
  checkInAt: Date | null;
  status: AttendanceRecordStatus;
  source: AttendanceSource;
  lateMinutes: number;
  note: string | null;
}

const DEFAULT_SETTINGS: OrgAttendanceSettings = {
  workStart: '10:00',
  graceMinutes: 15,
  workEnd: '18:30',
  weekendDays: [5, 6],
};

export function normalizeOrgSettings(raw: unknown): OrgAttendanceSettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_SETTINGS;
  }
  const obj = raw as Record<string, unknown>;
  const workStart =
    typeof obj.workStart === 'string' && /^\d{2}:\d{2}$/.test(obj.workStart)
      ? obj.workStart
      : DEFAULT_SETTINGS.workStart;
  const workEnd =
    typeof obj.workEnd === 'string' && /^\d{2}:\d{2}$/.test(obj.workEnd)
      ? obj.workEnd
      : DEFAULT_SETTINGS.workEnd;
  const graceMinutes =
    typeof obj.graceMinutes === 'number' && obj.graceMinutes >= 0
      ? Math.floor(obj.graceMinutes)
      : DEFAULT_SETTINGS.graceMinutes;
  const weekendDays = Array.isArray(obj.weekendDays)
    ? obj.weekendDays.filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
    : DEFAULT_SETTINGS.weekendDays;

  return { workStart, graceMinutes, workEnd, weekendDays };
}

export function getOrgZonedParts(
  instant: Date,
  timezone: string,
): { dateStr: string; minutesSinceMidnight: number; dayOfWeek: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  const hour = Number(map.hour) % 24;
  const minute = Number(map.minute);
  const dateStr = `${map.year}-${map.month}-${map.day}`;
  const dayOfWeek = new Date(`${dateStr}T00:00:00Z`).getUTCDay();

  return {
    dateStr,
    minutesSinceMidnight: hour * 60 + minute,
    dayOfWeek,
  };
}

export function parseTimeToMinutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(':').map(Number);
  return hh * 60 + mm;
}

export function toIsoDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getMonthStartIso(workDateStr: string): string {
  return `${workDateStr.slice(0, 7)}-01`;
}

export function evaluateCheckInPunctuality(
  checkInInstant: Date,
  timezone: string,
  settings: OrgAttendanceSettings,
): { workDate: string; status: 'present' | 'late'; lateMinutes: number } {
  const { dateStr, minutesSinceMidnight } = getOrgZonedParts(checkInInstant, timezone);
  const cutoffMinutes = parseTimeToMinutes(settings.workStart) + settings.graceMinutes;

  if (minutesSinceMidnight <= cutoffMinutes) {
    return { workDate: dateStr, status: 'present', lateMinutes: 0 };
  }

  return {
    workDate: dateStr,
    status: 'late',
    lateMinutes: minutesSinceMidnight - cutoffMinutes,
  };
}

export function enumerateIsoDates(fromIso: string, toIso: string): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return dates;
}

export interface BuildAttendanceBoardInput {
  now: Date;
  timezone: string;
  settings: OrgAttendanceSettings;
  from: string;
  to: string;
  joiningDate: string;
  exitDate: string | null;
  isEmployeeActive: boolean;
  holidayDates: Set<string>;
  storedRows: StoredAttendanceRow[];
  todayStoredRow: StoredAttendanceRow | null;
}

export function buildAttendanceBoard(input: BuildAttendanceBoardInput): {
  today: TodayAttendanceDto;
  summary: MonthlyAttendanceSummaryDto;
  records: AttendanceRecordDto[];
} {
  const { dateStr: todayDateStr, minutesSinceMidnight: nowMinutes } = getOrgZonedParts(
    input.now,
    input.timezone,
  );
  const workEndMinutes = parseTimeToMinutes(input.settings.workEnd);
  const hasWorkDayEndedToday = nowMinutes >= workEndMinutes;
  const weekendSet = new Set(input.settings.weekendDays);

  const isWorkingDay = (isoDate: string): boolean => {
    const dow = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
    if (weekendSet.has(dow)) return false;
    if (input.holidayDates.has(isoDate)) return false;
    return true;
  };

  const isWithinEmployment = (isoDate: string): boolean => {
    if (isoDate < input.joiningDate) return false;
    if (input.exitDate && isoDate > input.exitDate) return false;
    return true;
  };

  let today: TodayAttendanceDto;
  if (input.todayStoredRow) {
    today = {
      workDate: todayDateStr,
      status: input.todayStoredRow.status,
      checkInAt: input.todayStoredRow.checkInAt
        ? input.todayStoredRow.checkInAt.toISOString()
        : null,
      lateMinutes: input.todayStoredRow.lateMinutes,
      source: input.todayStoredRow.source,
    };
  } else if (
    input.isEmployeeActive &&
    isWithinEmployment(todayDateStr) &&
    isWorkingDay(todayDateStr) &&
    hasWorkDayEndedToday
  ) {
    today = {
      workDate: todayDateStr,
      status: 'absent',
      checkInAt: null,
      lateMinutes: 0,
      source: null,
    };
  } else {
    today = {
      workDate: todayDateStr,
      status: 'not_checked_in',
      checkInAt: null,
      lateMinutes: 0,
      source: null,
    };
  }

  const storedByDate = new Map<string, StoredAttendanceRow>();
  for (const row of input.storedRows) {
    storedByDate.set(toIsoDateString(row.workDate), row);
  }

  const records: AttendanceRecordDto[] = [];
  let presentDays = 0;
  let lateDays = 0;
  let absentDays = 0;
  let expectedWorkingDays = 0;

  for (const isoDate of enumerateIsoDates(input.from, input.to)) {
    const stored = storedByDate.get(isoDate);
    const working = isWorkingDay(isoDate);
    const employed = isWithinEmployment(isoDate);
    const isPastDay = isoDate < todayDateStr;
    const isTodayEnded = isoDate === todayDateStr && hasWorkDayEndedToday;

    if (stored) {
      records.push({
        id: stored.id,
        workDate: isoDate,
        checkInAt: stored.checkInAt ? stored.checkInAt.toISOString() : null,
        status: stored.status,
        source: stored.source,
        lateMinutes: stored.lateMinutes,
        note: stored.note,
        isDerived: false,
      });

      if (stored.status === 'present') presentDays += 1;
      else if (stored.status === 'late') lateDays += 1;
      else if (stored.status === 'absent') absentDays += 1;

      if (working && employed && (isPastDay || isTodayEnded || stored.status !== 'absent')) {
        expectedWorkingDays += 1;
      }
      continue;
    }

    if (input.isEmployeeActive && working && employed && (isPastDay || isTodayEnded)) {
      records.push({
        id: null,
        workDate: isoDate,
        checkInAt: null,
        status: 'absent',
        source: null,
        lateMinutes: 0,
        note: null,
        isDerived: true,
      });
      absentDays += 1;
      expectedWorkingDays += 1;
    }
  }

  const attendedDays = presentDays + lateDays;
  const attendanceRatePercent =
    expectedWorkingDays > 0
      ? Math.round((attendedDays / expectedWorkingDays) * 1000) / 10
      : 100;

  return {
    today,
    summary: {
      presentDays,
      lateDays,
      absentDays,
      expectedWorkingDays,
      attendanceRatePercent,
    },
    records,
  };
}
