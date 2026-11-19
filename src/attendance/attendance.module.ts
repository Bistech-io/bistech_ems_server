import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceRepository } from './attendance.repository.js';
import { AttendanceService } from './attendance.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AttendanceController],
  providers: [AttendanceRepository, AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
