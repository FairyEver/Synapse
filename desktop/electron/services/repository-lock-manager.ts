import { createMainLogger } from "./log-store"

const logger = createMainLogger("repository-lock-manager")

const LOCK_ACQUIRE_TIMEOUT_MS = 30_000

type QueueEntry = {
  resolve: () => void
  reject: (error: Error) => void
  operation: string
}

class RepositoryLockManager {
  private locks = new Map<string, { operation: string; queue: QueueEntry[] }>()

  async acquire(repositoryUuid: string, operation: string): Promise<() => void> {
    const existing = this.locks.get(repositoryUuid)

    if (!existing) {
      this.locks.set(repositoryUuid, { operation, queue: [] })
      logger.debug("Lock acquired.", { repositoryUuid, operation })
      return () => this.release(repositoryUuid)
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

  private release(repositoryUuid: string): void {
    const lock = this.locks.get(repositoryUuid)
    if (!lock) return

    const next = lock.queue.shift()
    if (next) {
      lock.operation = next.operation
      logger.debug("Lock transferred.", { repositoryUuid, operation: next.operation })
      next.resolve()
    } else {
      this.locks.delete(repositoryUuid)
      logger.debug("Lock released.", { repositoryUuid })
    }
  }
}

export const repositoryLockManager = new RepositoryLockManager()
