import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EmployeesService } from './employees.service.js';
import { EmployeesController } from './employees.controller.js';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [EmployeesController, ProfileController],
  providers: [EmployeesService, ProfileService],
  exports: [EmployeesService, ProfileService],
})
export class EmployeesModule {}

