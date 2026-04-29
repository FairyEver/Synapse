import type { TaskAction, TaskActionExecutor } from "./types"

export class TaskActionRegistry {
  private readonly executors = new Map<TaskAction["type"], TaskActionExecutor>()

  register(executor: TaskActionExecutor): void {
    if (this.executors.has(executor.type)) {
      throw new Error(`Task action "${executor.type}" is already registered`)
    }
    this.executors.set(executor.type, executor)
  }

  get(type: TaskAction["type"]): TaskActionExecutor {
    const executor = this.executors.get(type)
    if (!executor) throw new Error(`Task action "${type}" is not registered`)
    return executor
  }
}
