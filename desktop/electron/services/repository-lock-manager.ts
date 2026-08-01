import path from "node:path"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("repository-lock-manager")

type QueueEntry = {
  resolve: (token: number) => void
  operation: string
}

type LockState = {
  token: number
  operation: string
  acquiredAt: number
  queue: QueueEntry[]
}

class RepositoryLockManager {
  private locks = new Map<string, LockState>()
  private nextToken = 1

  async acquire(repositoryUuid: string, operation: string): Promise<() => void> {
    repositoryUuid = path.resolve(repositoryUuid)
    const existing = this.locks.get(repositoryUuid)

    if (!existing) {
      return this.grantLock(repositoryUuid, operation)
    }

    return new Promise<() => void>((resolve) => {
      const resolveEntry = (token: number) => {
        resolve(() => this.release(repositoryUuid, token))
      }

      existing.queue.push({
        resolve: resolveEntry,
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
    const token = this.nextToken++
    this.locks.set(repositoryUuid, {
      token,
      operation,
      acquiredAt: Date.now(),
      queue: [],
    })
    logger.debug("Lock acquired.", { repositoryUuid, operation })
    return () => this.release(repositoryUuid, token)
  }

  private release(repositoryUuid: string, token: number): void {
    const lock = this.locks.get(repositoryUuid)
    if (!lock) return

    if (lock.token !== token) {
      logger.debug("Stale release ignored.", { repositoryUuid, expectedToken: lock.token, callerToken: token })
      return
    }

    const next = lock.queue.shift()
    if (next) {
      const nextToken = this.nextToken++
      lock.token = nextToken
      lock.operation = next.operation
      lock.acquiredAt = Date.now()
      logger.debug("Lock transferred.", { repositoryUuid, operation: next.operation })
      next.resolve(nextToken)
    } else {
      this.locks.delete(repositoryUuid)
      logger.debug("Lock released.", { repositoryUuid })
    }
  }

}

export const repositoryLockManager = new RepositoryLockManager()
