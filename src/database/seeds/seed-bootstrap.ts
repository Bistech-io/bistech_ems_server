import 'dotenv/config';
import { PrismaClient, PermissionScope, EmploymentType, EmploymentStatus, HistoryEventType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as argon2 from 'argon2';

const connectionString =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL ||
  'postgresql://ems_app:postgres@localhost:5432/ems?schema=public';

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PERMISSIONS = [
  { key: 'user.read', description: 'Read users and their profile details' },
  { key: 'user.manage', description: 'Manage users, invites, and account statuses' },
  { key: 'role.manage', description: 'Assign and manage user roles' },
  { key: 'audit.read', description: 'Read system audit logs' },
  { key: 'org.settings.manage', description: 'Manage organization settings and configuration' },
  { key: 'employee.read', description: 'Read employee directory and public profile information' },
  { key: 'employee.read.sensitive', description: 'Read sensitive employee profile details' },
  { key: 'employee.create', description: 'Create and onboard new employees' },
  { key: 'employee.update', description: 'Update employee records' },
  { key: 'employee.status.manage', description: 'Deactivate or reactivate employees' },
  { key: 'employee.history.read', description: 'Read employee employment history' },
  { key: 'org.structure.read', description: 'Read organization structure including departments and designations' },
  { key: 'org.structure.manage', description: 'Manage departments, designations, and holidays' },
  { key: 'department.head.assign', description: 'Assign or change department heads' },
  { key: 'attendance.self', description: 'Check in and view own attendance records' },
  { key: 'attendance.read', description: 'Read attendance records within allowed scope' },
  { key: 'attendance.correct', description: 'Submit HR attendance corrections' },
  { key: 'task.create.self', description: 'Create personal tasks assigned to oneself' },
  { key: 'task.assign', description: 'Assign tasks to individuals or teams' },
  { key: 'task.read', description: 'Read tasks within allowed scope' },
  { key: 'task.board.team', description: 'View team task board' },
  { key: 'task.board.department', description: 'View department task board' },
  { key: 'task.work', description: 'Work on, submit, and transition assigned tasks' },
  { key: 'task.comment', description: 'Comment on tasks within allowed scope' },
  { key: 'task.review', description: 'Review task submissions (approve / request changes)' },
  { key: 'task.manage', description: 'Manage and cancel tasks' },
  { key: 'team.read', description: 'Read team information and members' },
  { key: 'team.manage', description: 'Create and manage teams and member assignments' },
  { key: 'dashboard.read', description: 'Access dashboards within allowed scope' },
  { key: 'feedback.submit', description: 'Submit feedback, suggestions, or issues' },
  { key: 'feedback.read', description: 'Read feedback within allowed scope' },
  { key: 'feedback.manage', description: 'Triage and resolve feedback items' },
];

const ROLE_DEFINITIONS = [
  {
    name: 'super_admin',
    description: 'System Super Administrator with full organization access',
    isSystem: true,
    permissions: PERMISSIONS.map((p) => ({ key: p.key, scope: PermissionScope.org })),
  },
  {
    name: 'hr_manager',
    description: 'Human Resources Manager',
    isSystem: true,
    permissions: [
      { key: 'employee.read', scope: PermissionScope.org },
      { key: 'employee.read.sensitive', scope: PermissionScope.org },
      { key: 'employee.create', scope: PermissionScope.org },
      { key: 'employee.update', scope: PermissionScope.org },
      { key: 'employee.status.manage', scope: PermissionScope.org },
      { key: 'employee.history.read', scope: PermissionScope.org },
      { key: 'org.structure.read', scope: PermissionScope.org },
      { key: 'org.structure.manage', scope: PermissionScope.org },
      { key: 'department.head.assign', scope: PermissionScope.org },
      { key: 'attendance.self', scope: PermissionScope.own },
      { key: 'attendance.read', scope: PermissionScope.org },
      { key: 'attendance.correct', scope: PermissionScope.org },
      { key: 'task.create.self', scope: PermissionScope.own },
      { key: 'task.read', scope: PermissionScope.org },
      { key: 'task.work', scope: PermissionScope.own },
      { key: 'task.comment', scope: PermissionScope.org },
      { key: 'team.read', scope: PermissionScope.org },
      { key: 'dashboard.read', scope: PermissionScope.org },
      { key: 'feedback.submit', scope: PermissionScope.own },
      { key: 'feedback.read', scope: PermissionScope.org },
      { key: 'feedback.manage', scope: PermissionScope.org },
    ],
  },
  {
    name: 'dept_head',
    description: 'Department Head',
    isSystem: true,
    permissions: [
      { key: 'employee.read', scope: PermissionScope.department },
      { key: 'org.structure.read', scope: PermissionScope.org },
      { key: 'attendance.self', scope: PermissionScope.own },
      { key: 'attendance.read', scope: PermissionScope.department },
      { key: 'task.create.self', scope: PermissionScope.own },
      { key: 'task.assign', scope: PermissionScope.department },
      { key: 'task.read', scope: PermissionScope.department },
      { key: 'task.board.department', scope: PermissionScope.department },
      { key: 'task.work', scope: PermissionScope.own },
      { key: 'task.comment', scope: PermissionScope.department },
      { key: 'task.review', scope: PermissionScope.department },
      { key: 'task.manage', scope: PermissionScope.department },
      { key: 'team.read', scope: PermissionScope.department },
      { key: 'team.manage', scope: PermissionScope.department },
      { key: 'dashboard.read', scope: PermissionScope.department },
      { key: 'feedback.submit', scope: PermissionScope.own },
      { key: 'feedback.read', scope: PermissionScope.department },
    ],
  },
  {
    name: 'employee',
    description: 'Standard Employee',
    isSystem: true,
    permissions: [
      { key: 'employee.read', scope: PermissionScope.own },
      { key: 'attendance.self', scope: PermissionScope.own },
      { key: 'task.create.self', scope: PermissionScope.own },
      { key: 'task.read', scope: PermissionScope.team },
      { key: 'task.board.team', scope: PermissionScope.team },
      { key: 'task.work', scope: PermissionScope.own },
      { key: 'task.comment', scope: PermissionScope.team },
      { key: 'team.read', scope: PermissionScope.team },
      { key: 'dashboard.read', scope: PermissionScope.own },
      { key: 'feedback.submit', scope: PermissionScope.own },
      { key: 'feedback.read', scope: PermissionScope.own },
    ],
  },
];

async function seed() {
  console.log('--- Starting Bootstrap Seed ---');

  // 1. Seed Permissions
  console.log('Seeding 32 permissions...');
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: { description: perm.description },
      create: { key: perm.key, description: perm.description },
    });
  }
  const dbPermissions = await prisma.permission.findMany();
  const permMap = new Map(dbPermissions.map((p) => [p.key, p.id]));

  // 2. Seed Default Organization
  console.log('Seeding default organization (bistech)...');
  const org = await prisma.organization.upsert({
    where: { slug: 'bistech' },
    update: {
      name: 'BisTech',
      employeeCodePrefix: 'BST',
      lastEmployeeNumber: 1003,
    },
    create: {
      name: 'BisTech',
      slug: 'bistech',
      timezone: 'Asia/Dhaka',
      employeeCodePrefix: 'BST',
      lastEmployeeNumber: 1003,
      settings: {
        workStart: '10:00',
        graceMinutes: 15,
        workEnd: '18:30',
        weekendDays: [5, 6],
      },
    },
  });

  // 3. Seed System Roles & Role Permissions
  console.log('Seeding system roles & role permissions...');
  const roleMap = new Map<string, string>();
  for (const roleDef of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: {
        organizationId_name: {
          organizationId: org.id,
          name: roleDef.name,
        },
      },
      update: { description: roleDef.description, isSystem: roleDef.isSystem },
      create: {
        organizationId: org.id,
        name: roleDef.name,
        description: roleDef.description,
        isSystem: roleDef.isSystem,
      },
    });

    roleMap.set(roleDef.name, role.id);

    for (const p of roleDef.permissions) {
      const permId = permMap.get(p.key);
      if (!permId) continue;
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permId,
          },
        },
        update: { scope: p.scope },
        create: {
          roleId: role.id,
          permissionId: permId,
          scope: p.scope,
        },
      });
    }
  }

  // 4. Seed Departments
  console.log('Seeding departments...');
  const deptEngineering = await prisma.department.upsert({
    where: {
      organizationId_name: {
        organizationId: org.id,
        name: 'Engineering',
      },
    },
    update: { description: 'Software Engineering and Product Development' },
    create: {
      organizationId: org.id,
      name: 'Engineering',
      description: 'Software Engineering and Product Development',
    },
  });

  const deptHR = await prisma.department.upsert({
    where: {
      organizationId_name: {
        organizationId: org.id,
        name: 'Human Resources',
      },
    },
    update: { description: 'People Operations, Talent, and Culture' },
    create: {
      organizationId: org.id,
      name: 'Human Resources',
      description: 'People Operations, Talent, and Culture',
    },
  });

  const deptManagement = await prisma.department.upsert({
    where: {
      organizationId_name: {
        organizationId: org.id,
        name: 'Management',
      },
    },
    update: { description: 'Executive and Operations Leadership' },
    create: {
      organizationId: org.id,
      name: 'Management',
      description: 'Executive and Operations Leadership',
    },
  });

  // 5. Seed Designations
  console.log('Seeding designations...');
  const desigHRManager = await prisma.designation.upsert({
    where: {
      organizationId_title: {
        organizationId: org.id,
        title: 'HR Manager',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      title: 'HR Manager',
    },
  });

  const desigLeadEng = await prisma.designation.upsert({
    where: {
      organizationId_title: {
        organizationId: org.id,
        title: 'Lead Engineer',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      title: 'Lead Engineer',
    },
  });

  const desigSoftwareEng = await prisma.designation.upsert({
    where: {
      organizationId_title: {
        organizationId: org.id,
        title: 'Software Engineer',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      title: 'Software Engineer',
    },
  });

  const desigExecutive = await prisma.designation.upsert({
    where: {
      organizationId_title: {
        organizationId: org.id,
        title: 'Executive',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      title: 'Executive',
    },
  });

  const defaultPasswordHash = await argon2.hash('Password123!', {
    type: argon2.argon2id,
  });

  // 6. Seed Accounts & Employees
  console.log('Seeding the 4 primary accounts and employees...');

  // 6.1 Super Admin (`admin` / `Password123!`)
  const adminUser = await prisma.user.upsert({
    where: {
      organizationId_username: {
        organizationId: org.id,
        username: 'admin',
      },
    },
    update: {
      email: 'admin@bistech.io',
      displayName: 'BisTech Admin',
      passwordHash: defaultPasswordHash,
      accountStatus: 'active',
      failedLoginCount: 0,
      lockedUntil: null,
    },
    create: {
      organizationId: org.id,
      username: 'admin',
      email: 'admin@bistech.io',
      displayName: 'BisTech Admin',
      passwordHash: defaultPasswordHash,
      accountStatus: 'active',
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: roleMap.get('super_admin')!,
      },
    },
    update: {
      organizationId: org.id,
      assignedBy: adminUser.id,
    },
    create: {
      organizationId: org.id,
      userId: adminUser.id,
      roleId: roleMap.get('super_admin')!,
      assignedBy: adminUser.id,
    },
  });

  // 6.2 HR Manager (`hr` / `Password123!`) -> BST-1001
  const hrUser = await prisma.user.upsert({
    where: {
      organizationId_username: {
        organizationId: org.id,
        username: 'hr',
      },
    },
    update: {
      email: 'hr@bistech.io',
      displayName: 'Nadia Rahman',
      passwordHash: defaultPasswordHash,
      accountStatus: 'active',
      failedLoginCount: 0,
      lockedUntil: null,
    },
    create: {
      organizationId: org.id,
      username: 'hr',
      email: 'hr@bistech.io',
      displayName: 'Nadia Rahman',
      passwordHash: defaultPasswordHash,
      accountStatus: 'active',
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: hrUser.id,
        roleId: roleMap.get('hr_manager')!,
      },
    },
    update: {
      organizationId: org.id,
      assignedBy: adminUser.id,
    },
    create: {
      organizationId: org.id,
      userId: hrUser.id,
      roleId: roleMap.get('hr_manager')!,
      assignedBy: adminUser.id,
    },
  });

  const hrEmployee = await prisma.employee.upsert({
    where: { userId: hrUser.id },
    update: {
      employeeCode: 'BST-1001',
      firstName: 'Nadia',
      lastName: 'Rahman',
      workEmail: 'hr@bistech.io',
      phone: '+8801711000001',
      departmentId: deptHR.id,
      designationId: desigHRManager.id,
      employmentType: EmploymentType.full_time,
      employmentStatus: EmploymentStatus.active,
      joiningDate: new Date('2024-01-15'),
    },
    create: {
      organizationId: org.id,
      userId: hrUser.id,
      employeeCode: 'BST-1001',
      firstName: 'Nadia',
      lastName: 'Rahman',
      workEmail: 'hr@bistech.io',
      phone: '+8801711000001',
      departmentId: deptHR.id,
      designationId: desigHRManager.id,
      employmentType: EmploymentType.full_time,
      employmentStatus: EmploymentStatus.active,
      joiningDate: new Date('2024-01-15'),
    },
  });

  await prisma.employeeProfile.upsert({
    where: { employeeId: hrEmployee.id },
    update: { city: 'Dhaka', countryCode: 'BD' },
    create: {
      organizationId: org.id,
      employeeId: hrEmployee.id,
      city: 'Dhaka',
      countryCode: 'BD',
    },
  });

  // 6.3 Department Head (`head` / `Password123!`) -> BST-1002
  const headUser = await prisma.user.upsert({
    where: {
      organizationId_username: {
        organizationId: org.id,
        username: 'head',
      },
    },
    update: {
      email: 'head@bistech.io',
      displayName: 'Farhan Ahmed',
      passwordHash: defaultPasswordHash,
      accountStatus: 'active',
      failedLoginCount: 0,
      lockedUntil: null,
    },
    create: {
      organizationId: org.id,
      username: 'head',
      email: 'head@bistech.io',
      displayName: 'Farhan Ahmed',
      passwordHash: defaultPasswordHash,
      accountStatus: 'active',
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: headUser.id,
        roleId: roleMap.get('dept_head')!,
      },
    },
    update: {
      organizationId: org.id,
      assignedBy: adminUser.id,
    },
    create: {
      organizationId: org.id,
      userId: headUser.id,
      roleId: roleMap.get('dept_head')!,
      assignedBy: adminUser.id,
    },
  });

  const headEmployee = await prisma.employee.upsert({
    where: { userId: headUser.id },
    update: {
      employeeCode: 'BST-1002',
      firstName: 'Farhan',
      lastName: 'Ahmed',
      workEmail: 'head@bistech.io',
      phone: '+8801711000002',
      departmentId: deptEngineering.id,
      designationId: desigLeadEng.id,
      employmentType: EmploymentType.full_time,
      employmentStatus: EmploymentStatus.active,
      joiningDate: new Date('2024-02-01'),
    },
    create: {
      organizationId: org.id,
      userId: headUser.id,
      employeeCode: 'BST-1002',
      firstName: 'Farhan',
      lastName: 'Ahmed',
      workEmail: 'head@bistech.io',
      phone: '+8801711000002',
      departmentId: deptEngineering.id,
      designationId: desigLeadEng.id,
      employmentType: EmploymentType.full_time,
      employmentStatus: EmploymentStatus.active,
      joiningDate: new Date('2024-02-01'),
    },
  });

  await prisma.employeeProfile.upsert({
    where: { employeeId: headEmployee.id },
    update: { city: 'Dhaka', countryCode: 'BD' },
    create: {
      organizationId: org.id,
      employeeId: headEmployee.id,
      city: 'Dhaka',
      countryCode: 'BD',
    },
  });

  // Assign Farhan Ahmed as Department Head of Engineering
  await prisma.department.update({
    where: { id: deptEngineering.id },
    data: { headEmployeeId: headEmployee.id },
  });

  // 6.4 Standard Employee (`employee` / `Password123!`) -> BST-1003
  const standardUser = await prisma.user.upsert({
    where: {
      organizationId_username: {
        organizationId: org.id,
        username: 'employee',
      },
    },
    update: {
      email: 'employee@bistech.io',
      displayName: 'Mehedi Alam',
      passwordHash: defaultPasswordHash,
      accountStatus: 'active',
      failedLoginCount: 0,
      lockedUntil: null,
    },
    create: {
      organizationId: org.id,
      username: 'employee',
      email: 'employee@bistech.io',
      displayName: 'Mehedi Alam',
      passwordHash: defaultPasswordHash,
      accountStatus: 'active',
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: standardUser.id,
        roleId: roleMap.get('employee')!,
      },
    },
    update: {
      organizationId: org.id,
      assignedBy: adminUser.id,
    },
    create: {
      organizationId: org.id,
      userId: standardUser.id,
      roleId: roleMap.get('employee')!,
      assignedBy: adminUser.id,
    },
  });

  const standardEmployee = await prisma.employee.upsert({
    where: { userId: standardUser.id },
    update: {
      employeeCode: 'BST-1003',
      firstName: 'Mehedi',
      lastName: 'Alam',
      workEmail: 'employee@bistech.io',
      phone: '+8801711000003',
      departmentId: deptEngineering.id,
      designationId: desigSoftwareEng.id,
      employmentType: EmploymentType.full_time,
      employmentStatus: EmploymentStatus.active,
      joiningDate: new Date('2024-03-01'),
    },
    create: {
      organizationId: org.id,
      userId: standardUser.id,
      employeeCode: 'BST-1003',
      firstName: 'Mehedi',
      lastName: 'Alam',
      workEmail: 'employee@bistech.io',
      phone: '+8801711000003',
      departmentId: deptEngineering.id,
      designationId: desigSoftwareEng.id,
      employmentType: EmploymentType.full_time,
      employmentStatus: EmploymentStatus.active,
      joiningDate: new Date('2024-03-01'),
    },
  });

  await prisma.employeeProfile.upsert({
    where: { employeeId: standardEmployee.id },
    update: { city: 'Dhaka', countryCode: 'BD' },
    create: {
      organizationId: org.id,
      employeeId: standardEmployee.id,
      city: 'Dhaka',
      countryCode: 'BD',
    },
  });

  // Seed locked test user for E2E lockout verification
  await prisma.user.upsert({
    where: {
      organizationId_username: {
        organizationId: org.id,
        username: 'locked',
      },
    },
    update: {
      email: 'locked@bistech.io',
      displayName: 'Locked User',
      passwordHash: defaultPasswordHash,
      accountStatus: 'active',
      failedLoginCount: 5,
      lockedUntil: new Date(Date.now() + 60 * 60 * 1000),
    },
    create: {
      organizationId: org.id,
      username: 'locked',
      email: 'locked@bistech.io',
      displayName: 'Locked User',
      passwordHash: defaultPasswordHash,
      accountStatus: 'active',
      failedLoginCount: 5,
      lockedUntil: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  console.log('Bootstrap seed completed successfully!');
  console.log({
    organization: org.slug,
    accounts: [
      { role: 'super_admin', username: 'admin', employeeCode: null },
      { role: 'hr_manager', username: 'hr', employeeCode: 'BST-1001' },
      { role: 'dept_head', username: 'head', employeeCode: 'BST-1002' },
      { role: 'employee', username: 'employee', employeeCode: 'BST-1003' },
    ],
  });
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
