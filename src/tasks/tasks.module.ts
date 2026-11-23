import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { AssignmentsController } from './assignments.controller.js';
import { CommentsController } from './comments.controller.js';
import { SubmissionsController } from './submissions.controller.js';
import { TasksWorkflowService } from './tasks-workflow.service.js';
import { TasksController } from './tasks.controller.js';
import { TasksRepository } from './tasks.repository.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    TasksController,
    AssignmentsController,
    SubmissionsController,
    CommentsController,
  ],
  providers: [TasksRepository, TasksService, TasksWorkflowService],
  exports: [TasksService, TasksWorkflowService],
})
export class TasksModule {}
