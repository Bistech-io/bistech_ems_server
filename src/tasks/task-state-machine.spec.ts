import { ConflictException } from '@nestjs/common';
import {
  assertCanSubmitFromStatus,
  assertManualStatusTransition,
} from './task-state-machine.js';

describe('task-state-machine', () => {
  it('allows todo <-> in_progress and changes_requested -> in_progress', () => {
    expect(() => assertManualStatusTransition('todo', 'in_progress')).not.toThrow();
    expect(() => assertManualStatusTransition('in_progress', 'todo')).not.toThrow();
    expect(() =>
      assertManualStatusTransition('changes_requested', 'in_progress'),
    ).not.toThrow();
  });

  it('rejects illegal manual transitions with ConflictException (T-44)', () => {
    expect(() => assertManualStatusTransition('in_review', 'in_progress')).toThrow(
      ConflictException,
    );
    expect(() => assertManualStatusTransition('done', 'todo')).toThrow(
      ConflictException,
    );
    expect(() => assertManualStatusTransition('cancelled', 'in_progress')).toThrow(
      ConflictException,
    );
  });

  it('allows submission from todo, in_progress, changes_requested and rejects done/in_review', () => {
    expect(() => assertCanSubmitFromStatus('todo')).not.toThrow();
    expect(() => assertCanSubmitFromStatus('in_progress')).not.toThrow();
    expect(() => assertCanSubmitFromStatus('changes_requested')).not.toThrow();
    expect(() => assertCanSubmitFromStatus('done')).toThrow(ConflictException);
    expect(() => assertCanSubmitFromStatus('in_review')).toThrow(ConflictException);
  });
});
