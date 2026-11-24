import { NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import type { PrismaService } from '../database/prisma.service.js';
import { ProfileService } from './profile.service.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const EMP_ID = '22222222-2222-2222-2222-222222222222';
const OWNER_USER_ID = '33333333-3333-3333-3333-333333333333';
const HR_USER_ID = '44444444-4444-4444-4444-444444444444';
const OTHER_USER_ID = '55555555-5555-5555-5555-555555555555';

const HR_CALLER: AuthenticatedUser = {
  userId: HR_USER_ID,
  organizationId: ORG_ID,
  sessionId: 'sess-hr',
  roles: ['hr_manager'],
};

const OWNER_CALLER: AuthenticatedUser = {
  userId: OWNER_USER_ID,
  organizationId: ORG_ID,
  sessionId: 'sess-owner',
  roles: ['employee'],
};

const OTHER_EMPLOYEE_CALLER: AuthenticatedUser = {
  userId: OTHER_USER_ID,
  organizationId: ORG_ID,
  sessionId: 'sess-other',
  roles: ['employee'],
};

function makeEmployeeRow() {
  return {
    id: EMP_ID,
    userId: OWNER_USER_ID,
    employeeCode: 'BST-1002',
    firstName: 'Farhan',
    lastName: 'Ahmed',
    workEmail: 'farhan@bistech.io',
    employmentStatus: 'active',
    department: { id: 'dept-1', name: 'Engineering' },
    designation: { id: 'desig-1', title: 'Lead Engineer' },
    profile: {
      dateOfBirth: new Date('1994-05-12T00:00:00Z'),
      personalEmail: 'farhan.personal@example.com',
      personalPhone: '+8801711000099',
      addressLine: 'House 12, Road 4',
      city: 'Dhaka',
      countryCode: 'BD',
      emergencyContactName: 'Sara Ahmed',
      emergencyContactPhone: '+8801711000088',
      emergencyContactRelation: 'Spouse',
      updatedAt: new Date('2026-11-20T10:00:00Z'),
    },
  };
}

describe('ProfileService', () => {
  it('allows HR manager to read sensitive profile and writes audit row (T-21)', async () => {
    const auditCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      employee: { findUnique: vi.fn().mockResolvedValue(makeEmployeeRow()) },
      auditLog: { create: auditCreate },
    } as unknown as PrismaService;

    const service = new ProfileService(prisma);
    const result = await service.getSensitiveProfile(EMP_ID, HR_CALLER);

    expect(result.employeeCode).toBe('BST-1002');
    expect(result.personalEmail).toBe('farhan.personal@example.com');
    expect(result.dateOfBirth).toBe('1994-05-12');
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        organizationId: ORG_ID,
        actorUserId: HR_USER_ID,
        action: 'employee.profile.read',
        entityType: 'employee_profile',
        entityId: EMP_ID,
        metadata: { employeeCode: 'BST-1002' },
      },
    });
  });

  it('allows owner to read own sensitive profile without writing non-owner audit row', async () => {
    const auditCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      employee: { findUnique: vi.fn().mockResolvedValue(makeEmployeeRow()) },
      auditLog: { create: auditCreate },
    } as unknown as PrismaService;

    const service = new ProfileService(prisma);
    const result = await service.getSensitiveProfile(EMP_ID, OWNER_CALLER);

    expect(result.employeeId).toBe(EMP_ID);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('returns 404 when another employee requests sensitive profile (T-16)', async () => {
    const prisma = {
      employee: { findUnique: vi.fn().mockResolvedValue(makeEmployeeRow()) },
      auditLog: { create: vi.fn() },
    } as unknown as PrismaService;

    const service = new ProfileService(prisma);

    await expect(
      service.getSensitiveProfile(EMP_ID, OTHER_EMPLOYEE_CALLER),
    ).rejects.toThrow(NotFoundException);
  });

  it('allows HR manager to update personal profile inside transaction with redacted audit log', async () => {
    const upsert = vi.fn().mockResolvedValue({
      ...makeEmployeeRow().profile,
      city: 'Chattogram',
    });
    const auditCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          employee: { findUnique: vi.fn().mockResolvedValue(makeEmployeeRow()) },
          employeeProfile: { upsert },
          auditLog: { create: auditCreate },
        }),
      ),
    } as unknown as PrismaService;

    const service = new ProfileService(prisma);
    const updated = await service.updateSensitiveProfile(
      EMP_ID,
      { city: 'Chattogram' },
      HR_CALLER,
    );

    expect(updated.city).toBe('Chattogram');
    expect(upsert).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        organizationId: ORG_ID,
        actorUserId: HR_USER_ID,
        action: 'employee.profile.updated',
        entityType: 'employee_profile',
        entityId: EMP_ID,
        metadata: {
          employeeCode: 'BST-1002',
          updatedFields: ['city'],
        },
      },
    });
  });

  it('allows owner employee to update their own personal profile via updateMySensitiveProfile', async () => {
    const upsert = vi.fn().mockResolvedValue({
      ...makeEmployeeRow().profile,
      city: 'Sylhet',
    });
    const auditCreate = vi.fn().mockResolvedValue({});
    const prisma = {
      employee: {
        findFirst: vi.fn().mockResolvedValue({ id: EMP_ID }),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          employee: { findUnique: vi.fn().mockResolvedValue(makeEmployeeRow()) },
          employeeProfile: { upsert },
          auditLog: { create: auditCreate },
        }),
      ),
    } as unknown as PrismaService;

    const service = new ProfileService(prisma);
    const updated = await service.updateMySensitiveProfile(
      { city: 'Sylhet' },
      OWNER_CALLER,
    );

    expect(updated.city).toBe('Sylhet');
    expect(upsert).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalled();
  });

  it('rejects non-HR non-owner employee attempting to update another profile with 404 NOT_FOUND', async () => {
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          employee: { findUnique: vi.fn().mockResolvedValue(makeEmployeeRow()) },
        }),
      ),
    } as unknown as PrismaService;
    const service = new ProfileService(prisma);

    await expect(
      service.updateSensitiveProfile(EMP_ID, { city: 'Sylhet' }, OTHER_EMPLOYEE_CALLER),
    ).rejects.toThrow(NotFoundException);
  });
});
