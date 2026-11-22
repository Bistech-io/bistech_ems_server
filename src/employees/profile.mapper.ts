export interface SensitiveEmployeeProfileDto {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  workEmail: string;
  department: { id: string; name: string };
  designation: { id: string; title: string };
  employmentStatus: string;
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
  return {
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    fullName: `${employee.firstName} ${employee.lastName}`.trim(),
    workEmail: employee.workEmail,
    department: employee.department,
    designation: employee.designation,
    employmentStatus: employee.employmentStatus,
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
