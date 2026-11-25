export interface SensitiveEmployeeProfileDto {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  workEmail: string;
  department: { id: string; name: string };
  designation: { id: string; title: string };
  employmentStatus: string;
  joiningDate?: string | null;
  organizationName?: string | null;
  timezone?: string | null;
  workStart?: string | null;
  workEnd?: string | null;
  dateOfBirth: string | null;
  personalEmail: string | null;
  personalPhone: string | null;
  addressLine: string | null;
  city: string | null;
  countryCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  updatedAt: string | null;
}

export interface EmployeeWithProfileRecord {
  id: string;
  userId: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  employmentStatus: string;
  joiningDate?: Date | null;
  organization?: {
    name: string;
    timezone: string;
    settings: unknown;
  } | null;
  department: { id: string; name: string };
  designation: { id: string; title: string };
  profile: {
    dateOfBirth: Date | null;
    personalEmail: string | null;
    personalPhone: string | null;
    addressLine: string | null;
    city: string | null;
    countryCode: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    emergencyContactRelation: string | null;
    updatedAt: Date;
  } | null;
}

export function toSensitiveProfileDto(
  employee: EmployeeWithProfileRecord,
): SensitiveEmployeeProfileDto {
  const p = employee.profile;
  const orgSettings =
    employee.organization?.settings &&
    typeof employee.organization.settings === 'object'
      ? (employee.organization.settings as Record<string, unknown>)
      : null;
  const attendance =
    orgSettings?.attendance && typeof orgSettings.attendance === 'object'
      ? (orgSettings.attendance as Record<string, unknown>)
      : null;

  return {
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    fullName: `${employee.firstName} ${employee.lastName}`.trim(),
    workEmail: employee.workEmail,
    department: employee.department,
    designation: employee.designation,
    employmentStatus: employee.employmentStatus,
    ...(employee.joiningDate !== undefined
      ? {
          joiningDate: employee.joiningDate
            ? employee.joiningDate.toISOString().slice(0, 10)
            : null,
        }
      : {}),
    ...(employee.organization
      ? {
          organizationName: employee.organization.name,
          timezone: employee.organization.timezone,
          workStart:
            typeof orgSettings?.workStart === 'string'
              ? orgSettings.workStart
              : typeof attendance?.workStart === 'string'
                ? attendance.workStart
                : '10:00',
          workEnd:
            typeof orgSettings?.workEnd === 'string'
              ? orgSettings.workEnd
              : typeof attendance?.workEnd === 'string'
                ? attendance.workEnd
                : '18:30',
        }
      : {}),
    dateOfBirth: p?.dateOfBirth ? p.dateOfBirth.toISOString().slice(0, 10) : null,
    personalEmail: p?.personalEmail ?? null,
    personalPhone: p?.personalPhone ?? null,
    addressLine: p?.addressLine ?? null,
    city: p?.city ?? null,
    countryCode: p?.countryCode ?? null,
    emergencyContactName: p?.emergencyContactName ?? null,
    emergencyContactPhone: p?.emergencyContactPhone ?? null,
    emergencyContactRelation: p?.emergencyContactRelation ?? null,
    updatedAt: p?.updatedAt ? p.updatedAt.toISOString() : null,
  };
}
