export type GitOperationStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export type GitOperationState = {
  readonly operationId: string
  readonly key: string
  readonly operation: string
  readonly repositoryId: string | null
  readonly status: GitOperationStatus
  readonly queuePosition: number
}

type RunInput<T> = {
  readonly key: string
  readonly operationId: string
  readonly operation: string
  readonly repositoryId?: string
  readonly task: (signal: AbortSignal) => Promise<T>
}

type QueueEntry<T = unknown> = RunInput<T> & {
  readonly controller: AbortController
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
}

type KeyState = {
  active: QueueEntry | null
  readonly queue: QueueEntry[]
  readonly idleWaiters: Array<() => void>
}

export class GitOperationCancelledError extends Error {
  constructor() {
    super("Git 操作已取消。")
    this.name = "GitOperationCancelledError"
  }
}

export function createGitOperationCoordinator(deps: {
  readonly acquireLock?: (key: string, operation: string) => Promise<() => void>
  readonly onStateChanged?: (state: GitOperationState) => void
} = {}) {
  const keys = new Map<string, KeyState>()
  const entries = new Map<string, QueueEntry>()
  const states = new Map<string, GitOperationState>()

  function emit(entry: QueueEntry, status: GitOperationStatus, queuePosition = 0): void {
    const state: GitOperationState = {
      operationId: entry.operationId,
      key: entry.key,
      operation: entry.operation,
      repositoryId: entry.repositoryId ?? null,
      status,
      queuePosition,
    }
    if (status === "queued" || status === "running") states.set(entry.operationId, state)
    else states.delete(entry.operationId)
    deps.onStateChanged?.(state)
  }

  function updateQueuePositions(keyState: KeyState): void {
    keyState.queue.forEach((entry, index) => emit(entry, "queued", index + 1))
  }

  function settleKey(key: string, keyState: KeyState): void {
    if (keyState.active || keyState.queue.length > 0) return
    keys.delete(key)
    keyState.idleWaiters.splice(0).forEach((resolve) => resolve())
  }

  function pump(key: string, keyState: KeyState): void {
    if (keyState.active) return
    const entry = keyState.queue.shift()
    if (!entry) {
      settleKey(key, keyState)
      return
    }
    keyState.active = entry
    updateQueuePositions(keyState)
    emit(entry, "running")
    void (async () => {
      const release = deps.acquireLock ? await deps.acquireLock(entry.key, entry.operation) : () => undefined
      try {
        if (entry.controller.signal.aborted) throw new GitOperationCancelledError()
        return await entry.task(entry.controller.signal)
      } finally {
        release()
      }
    })().then(
      (value) => {
        emit(entry, "completed")
        entry.resolve(value)
      },
      (error) => {
        const cancelled = entry.controller.signal.aborted || error instanceof GitOperationCancelledError
        emit(entry, cancelled ? "cancelled" : "failed")
        entry.reject(cancelled && !(error instanceof GitOperationCancelledError) ? new GitOperationCancelledError() : error)
      },
    ).finally(() => {
      entries.delete(entry.operationId)
      keyState.active = null
      pump(key, keyState)
    })
  }

  return {
    run<T>(input: RunInput<T>): Promise<T> {
      if (entries.has(input.operationId)) {
        return Promise.reject(new Error("Git operation ID 已存在。"))
      }
      const keyState = keys.get(input.key) ?? { active: null, queue: [], idleWaiters: [] }
      keys.set(input.key, keyState)
      return new Promise<T>((resolve, reject) => {
        const entry: QueueEntry<T> = {
          ...input,
          controller: new AbortController(),
          resolve,
          reject,
        }
        entries.set(input.operationId, entry as QueueEntry)
        keyState.queue.push(entry as QueueEntry)
        emit(entry as QueueEntry, "queued", keyState.queue.length)
        pump(input.key, keyState)
      })
    },

    cancel(operationId: string): boolean {
      const entry = entries.get(operationId)
      if (!entry) return false
      const keyState = keys.get(entry.key)
      if (!keyState) return false
      if (keyState.active === entry) {
        entry.controller.abort()
        return true
      }
      const index = keyState.queue.indexOf(entry)
      if (index < 0) return false
      keyState.queue.splice(index, 1)
      entries.delete(operationId)
      emit(entry, "cancelled")
      entry.reject(new GitOperationCancelledError())
      updateQueuePositions(keyState)
      settleKey(entry.key, keyState)
      return true
    },

    getState(operationId: string): GitOperationState | null {
      return states.get(operationId) ?? null
    },

    waitForIdle(key: string): Promise<void> {
      const keyState = keys.get(key)
      if (!keyState || (!keyState.active && keyState.queue.length === 0)) return Promise.resolve()
      return new Promise((resolve) => keyState.idleWaiters.push(resolve))
    },

    async read<T>(key: string, task: () => Promise<T>): Promise<T> {
      await this.waitForIdle(key)
      const release = deps.acquireLock ? await deps.acquireLock(key, "read") : () => undefined
      try {
        return await task()
      } finally {
        release()
      }
    },
  }
}

export type GitOperationCoordinator = ReturnType<typeof createGitOperationCoordinator>
