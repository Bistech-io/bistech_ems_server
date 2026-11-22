import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DepartmentsModule } from './departments/departments.module.js';
import { EmployeesModule } from './employees/employees.module.js';
import { AttendanceModule } from './attendance/index.js';
import { DashboardModule } from './dashboard/index.js';
import { OrganizationModule } from './organization/organization.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    DepartmentsModule,
    EmployeesModule,
    AttendanceModule,
    DashboardModule,
    OrganizationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
