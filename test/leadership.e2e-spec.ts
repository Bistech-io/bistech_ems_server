import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthGuard } from '../src/auth/auth.guard.js';
import { AuthService } from '../src/auth/auth.service.js';
import { AUTH_CONSTANTS } from '../src/auth/auth.constants.js';

describe('Manage HR & Department Head Endpoints (e2e)', () => {
  let app: INestApplication;
  let callerRole: string = 'super_admin';
  const callerUserId = '60a30f3f-37ce-48e5-97dd-7bfc7ac8a065'; // admin@bistech.io
  const orgId = 'b3b2ea06-fe38-42b7-9122-4c037c8ead0f';

  const mockAuthGuard = {
    canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      req.user = {
        userId: callerUserId,
        organizationId: orgId,
        sessionId: 'test-session',
        roles: [callerRole],
      };
      return true;
    },
  };

  beforeEach(async () => {
    callerRole = 'super_admin';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(AuthGuard)
      .useValue(mockAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /departments', () => {
    it('returns 200 and list of departments with active employee counts', async () => {
      const res = await request(app.getHttpServer())
        .get('/departments')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0]).toHaveProperty('id');
      expect(res.body.data[0]).toHaveProperty('name');
      expect(res.body.data[0]).toHaveProperty('activeEmployeeCount');
    });
  });

  describe('GET /roles', () => {
    it('returns 200 with list of system roles including super_admin, hr_manager, dept_head, employee', async () => {
      const res = await request(app.getHttpServer()).get('/roles').expect(200);

      expect(res.body.success).toBe(true);
      const roleNames = res.body.data.map((r: any) => r.name);
      expect(roleNames).toContain('super_admin');
      expect(roleNames).toContain('hr_manager');
      expect(roleNames).toContain('dept_head');
      expect(roleNames).toContain('employee');
    });

    it('returns 403 when called by a standard employee', async () => {
      callerRole = 'employee';
      await request(app.getHttpServer()).get('/roles').expect(403);
    });
  });

  describe('GET /users', () => {
    it('returns 200 with paginated user list', async () => {
      const res = await request(app.getHttpServer())
        .get('/users?page=1&limit=10')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBeGreaterThan(0);
    });

    it('filters users by role=hr_manager', async () => {
      const res = await request(app.getHttpServer())
        .get('/users?role=hr_manager')
        .expect(200);

      expect(res.body.success).toBe(true);
      res.body.data.forEach((u: any) => {
        expect(u.roles).toContain('hr_manager');
      });
    });

    it('returns 403 when called by non-admin/non-HR', async () => {
      callerRole = 'employee';
      await request(app.getHttpServer()).get('/users').expect(403);
    });
  });

  describe('Department Lifecycle (POST, PATCH, PUT /head, DELETE)', () => {
    let createdDeptId: string;

    it('POST /departments creates a department', async () => {
      const uniqueName = `QA Squad ${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/departments')
        .send({ name: uniqueName, description: 'Quality assurance' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe(uniqueName);
      createdDeptId = res.body.data.id;
    });

    it('PATCH /departments/:id updates department description', async () => {
      if (!createdDeptId) return;

      const res = await request(app.getHttpServer())
        .patch(`/departments/${createdDeptId}`)
        .send({ description: 'Updated description' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.description).toBe('Updated description');
    });

    it('PUT /departments/:id/head assigns and removes department head', async () => {
      if (!createdDeptId) return;

      // Assign Farhan Ahmed (employee id: 4c6529fa-2a49-4f53-b2b9-daf55323e0b3)
      const empId = '4c6529fa-2a49-4f53-b2b9-daf55323e0b3';
      const assignRes = await request(app.getHttpServer())
        .put(`/departments/${createdDeptId}/head`)
        .send({ employeeId: empId })
        .expect(200);

      expect(assignRes.body.success).toBe(true);
      expect(assignRes.body.data.headEmployeeId).toBe(empId);

      // Clear head (employeeId: null)
      const clearRes = await request(app.getHttpServer())
        .put(`/departments/${createdDeptId}/head`)
        .send({ employeeId: null })
        .expect(200);

      expect(clearRes.body.success).toBe(true);
      expect(clearRes.body.data.headEmployeeId).toBeNull();
    });

    it('DELETE /departments/:id archives the department', async () => {
      if (!createdDeptId) return;

      const res = await request(app.getHttpServer())
        .delete(`/departments/${createdDeptId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe('PUT /users/:id/roles', () => {
    it('blocks self-modification with 403 SELF_MODIFICATION_NOT_ALLOWED', async () => {
      const res = await request(app.getHttpServer())
        .put(`/users/${callerUserId}/roles`)
        .send({ roles: ['super_admin', 'hr_manager'] })
        .expect(403);

      expect(res.body.code).toBe('SELF_MODIFICATION_NOT_ALLOWED');
    });

    it('updates another user roles successfully', async () => {
      // Target Tanzim: 533eecb6-fd87-4dae-a254-3d4e860d256b
      const targetUserId = '533eecb6-fd87-4dae-a254-3d4e860d256b';
      const res = await request(app.getHttpServer())
        .put(`/users/${targetUserId}/roles`)
        .send({ roles: ['employee', 'hr_manager'] })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.roles).toContain('hr_manager');

      // Revert back
      await request(app.getHttpServer())
        .put(`/users/${targetUserId}/roles`)
        .send({ roles: ['employee'] })
        .expect(200);
    });
  });

  describe('POST /auth/reset-password', () => {
    it('allows an authenticated user to reset their password on first login setup', async () => {
      const authService = app.get(AuthService);
      const token = await authService.signAccessToken({
        sub: callerUserId,
        orgId,
        sessionId: 'a0000000-0000-0000-0000-000000000001',
        roles: ['super_admin'],
      });

      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .set('Cookie', [`${AUTH_CONSTANTS.COOKIE_ACCESS_NAME}=${token}`])
        .send({ newPassword: 'BrandNewSecurePass123!!' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Password reset successfully');

      // Also verify Bearer token header works and reset password back to seed password
      const revertRes = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ newPassword: 'Password123!' })
        .expect(200);

      expect(revertRes.body.success).toBe(true);
    });

    it('rejects unauthenticated request with missing reset token', async () => {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ newPassword: 'BrandNewSecurePass123!!' })
        .expect(401);
    });
  });
});
