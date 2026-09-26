/**
 * 单飞（single-flight）：同一个 key 上的并发调用共享同一个 Promise，只发一次真实请求。
 *
 * 为什么这是必须的（设计 F4）：进一个页面要串行 4 步 + 并发 10 个请求，
 * 无头下这些请求由 SDK 补发。如果两个能力（或两个并发调用）同时要同一份基础数据，
 * 没有单飞就会翻倍——那正是 Q66 担心的「峰值」。
 *
 * 实现上刻意保持「不缓存结果、只合并进行中的调用」：
 * 结果缓存是 PortalSession 的职责（它要知道 TTL、依赖、失效），
 * 这里只管「同一时刻只跑一次」。settle 之后立刻释放，下一次调用会重新执行。
 */
export class SingleFlight<T = unknown> {
  private readonly inflight = new Map<string, Promise<T>>()

  /** 当前进行中的调用数，测试和诊断用 */
  get size (): number {
    return this.inflight.size
  }

  has (key: string): boolean {
    return this.inflight.has(key)
  }

  /**
   * 跑一次 task。并发同 key 时只有第一次真正执行，其余拿到同一个 Promise。
   *
   * 注意 task 的同步阶段也在 return 之前跑完（`runTask` 是 async 函数），
   * 因此「先登记再启动」的顺序是安全的：登记发生在任何 task 内部的重入之前。
   */
  run (key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key)
    if (existing) {
      return existing
    }

    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    this.inflight.set(key, promise)

    let taskPromise: Promise<T>
    try {
      taskPromise = task()
    } catch (error) {
      this.finish(key, promise)
      reject(error)
      return promise
    }

    Promise.resolve(taskPromise).then(
      (value) => {
        this.finish(key, promise)
        resolve(value)
      },
      (error: unknown) => {
        this.finish(key, promise)
        reject(error)
      },
    )
    return promise
  }

  /** 丢弃登记（不取消已经开始的那次请求）。用于失效：丢弃后新调用会重新跑。 */
  forget (key: string): boolean {
    return this.inflight.delete(key)
  }

  clear (): void {
    this.inflight.clear()
  }

  private finish (key: string, promise: Promise<T>): void {
    if (this.inflight.get(key) === promise) {
      this.inflight.delete(key)
    }
  }
}
