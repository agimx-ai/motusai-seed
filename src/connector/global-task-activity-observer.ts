import type { WorkerEvent } from '../shared/contracts'

export type GlobalTaskActivity = Omit<Extract<WorkerEvent, { type: 'task.changed' }>, 'type' | 'phase'>
export type GlobalTaskActivityPhase = Extract<WorkerEvent, { type: 'task.changed' }>['phase']

/** Observes framework task activity without creating, scheduling, or controlling tasks. */
export class GlobalTaskActivityObserver {
  constructor(private readonly listener: (event: Extract<WorkerEvent, { type: 'task.changed' }>) => void) {}

  observe(activity: GlobalTaskActivity, phase: GlobalTaskActivityPhase) {
    this.listener({ type: 'task.changed', ...activity, phase })
  }
}
