import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DepartmentsService } from './departments.service.js';
import { DepartmentsController } from './departments.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
