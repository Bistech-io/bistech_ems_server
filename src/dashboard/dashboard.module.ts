import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardRepository } from './dashboard.repository.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [DashboardController],
  providers: [DashboardRepository, DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
