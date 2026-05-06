import { createMainLogger } from "./log-store"

const logger = createMainLogger("repository-lock-manager")

const LOCK_ACQUIRE_TIMEOUT_MS = 90_000
const LOCK_MAX_HOLD_MS = 120_000

type QueueEntry = {
  resolve: () => void
  reject: (error: Error) => void
  operation: string
}

type LockState = {
  operation: string
  acquiredAt: number
  queue: QueueEntry[]
  forceReleaseTimer: NodeJS.Timeout | null
}

class RepositoryLockManager {
  private locks = new Map<string, LockState>()

  async acquire(repositoryUuid: string, operation: string): Promise<() => void> {
    const existing = this.locks.get(repositoryUuid)

    if (!existing) {
      return this.grantLock(repositoryUuid, operation)
    }

    const holdDuration = Date.now() - existing.acquiredAt
    if (holdDuration >= LOCK_MAX_HOLD_MS) {
      logger.warn("Force-releasing stale lock.", {
        repositoryUuid,
        stalledOperation: existing.operation,
        holdDurationMs: holdDuration,
      })
      this.forceRelease(repositoryUuid)
      return this.grantLock(repositoryUuid, operation)
    }

    return new Promise<() => void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const lock = this.locks.get(repositoryUuid)
        if (lock) {
          lock.queue = lock.queue.filter((entry) => entry.resolve !== resolveEntry)
        }
        reject(new Error(
          `获取仓库锁超时（当前操作: ${existing.operation}，等待操作: ${operation}）`,
        ))
      }, LOCK_ACQUIRE_TIMEOUT_MS)

      const resolveEntry = () => {
        clearTimeout(timeout)
        resolve(() => this.release(repositoryUuid))
      }

      existing.queue.push({
        resolve: resolveEntry,
        reject: (error: Error) => {
          clearTimeout(timeout)
          reject(error)
        },
        operation,
      })

      logger.debug("Lock queued.", {
        repositoryUuid,
        operation,
        currentOperation: existing.operation,
        queueLength: existing.queue.length,
      })
    })
  }

  private grantLock(repositoryUuid: string, operation: string): () => void {
    const forceReleaseTimer = setTimeout(() => {
      const lock = this.locks.get(repositoryUuid)
      if (lock) {
        logger.warn("Lock held too long, force-releasing.", {
          repositoryUuid,
          operation: lock.operation,
          holdDurationMs: LOCK_MAX_HOLD_MS,
        })
        this.forceRelease(repositoryUuid)
      }
    }, LOCK_MAX_HOLD_MS)

    this.locks.set(repositoryUuid, {
      operation,
      acquiredAt: Date.now(),
      queue: [],
      forceReleaseTimer,
    })
    logger.debug("Lock acquired.", { repositoryUuid, operation })
    return () => this.release(repositoryUuid)
  }

  private release(repositoryUuid: string): void {
    const lock = this.locks.get(repositoryUuid)
    if (!lock) return

    if (lock.forceReleaseTimer) {
      clearTimeout(lock.forceReleaseTimer)
    }

    const next = lock.queue.shift()
    if (next) {
      lock.operation = next.operation
      lock.acquiredAt = Date.now()
      lock.forceReleaseTimer = setTimeout(() => {
        const current = this.locks.get(repositoryUuid)
        if (current) {
          logger.warn("Lock held too long, force-releasing.", {
            repositoryUuid,
            operation: current.operation,
            holdDurationMs: LOCK_MAX_HOLD_MS,
          })
          this.forceRelease(repositoryUuid)
        }
      }, LOCK_MAX_HOLD_MS)
      logger.debug("Lock transferred.", { repositoryUuid, operation: next.operation })
      next.resolve()
    } else {
      this.locks.delete(repositoryUuid)
      logger.debug("Lock released.", { repositoryUuid })
    }
  }

  private forceRelease(repositoryUuid: string): void {
    const lock = this.locks.get(repositoryUuid)
    if (!lock) return

    if (lock.forceReleaseTimer) {
      clearTimeout(lock.forceReleaseTimer)
    }

    const waiters = lock.queue.splice(0)
    this.locks.delete(repositoryUuid)

    if (waiters.length > 0) {
      const next = waiters[0]
      this.locks.set(repositoryUuid, {
        operation: next.operation,
        acquiredAt: Date.now(),
        queue: waiters.slice(1),
        forceReleaseTimer: setTimeout(() => {
          this.forceRelease(repositoryUuid)
        }, LOCK_MAX_HOLD_MS),
      })
      next.resolve()
    }
  }
}

export const repositoryLockManager = new RepositoryLockManager()
