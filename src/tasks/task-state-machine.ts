import { ConflictException } from '@nestjs/common';

export type AssignmentWorkflowStatus =
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'changes_requested'
  | 'done'
  | 'cancelled';

const ALLOWED_MANUAL_TRANSITIONS: Record<
  AssignmentWorkflowStatus,
  readonly ('todo' | 'in_progress')[]
> = {
  todo: ['in_progress'],
  in_progress: ['todo'],
  changes_requested: ['in_progress'],
  in_review: [],
  done: [],
  cancelled: [],
};

export function assertManualStatusTransition(
  from: AssignmentWorkflowStatus,
  to: 'todo' | 'in_progress',
): void {
  const allowed = ALLOWED_MANUAL_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new ConflictException({
      code: 'INVALID_TASK_TRANSITION',
      message: `Cannot transition task assignment from ${from} to ${to}`,
    });
  }
}

export function assertCanSubmitFromStatus(status: AssignmentWorkflowStatus): void {
  if (
    status !== 'todo' &&
    status !== 'in_progress' &&
    status !== 'changes_requested'
  ) {
    throw new ConflictException({
      code: 'INVALID_TASK_TRANSITION',
      message: `Cannot submit work when assignment status is ${status}`,
    });
  }
}
