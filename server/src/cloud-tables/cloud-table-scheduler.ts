import { OpenApiHttpError } from "../open-api/open-api.types"
export type SchedulerConfig = {
  concurrency: number
  ownerConcurrency: number
  tableConcurrency: number
  ownerQueue: number
  tableQueue: number
  globalQueue: number
  bytes: number
  waitMs: number
}
export type CloudTableLane = "read" | "write" | "auth"
type Job = { owner: string; key: string; bytes: number; cost: number; invoke: () => Promise<void>; reject: (e: Error) => void; clean: () => void }
const busy = (code: string, message: string) => new OpenApiHttpError(503, code, message)

/** 同一owner的总预算不变；owner内按表+读写lane分桶，避免热点表耗尽所有槽。 */
export function cloudTableQueueKey(owner: string, tableId: string | null, lane: CloudTableLane): string {
  return `${owner}:${tableId ?? "root"}:${lane}`
}

export class CloudTableScheduler {
  private queues = new Map<string, Job[]>()
  private runningKeys = new Map<string, number>()
  private runningOwners = new Map<string, number>()
  private credit = new Map<string, number>()
  private ownerPending = new Map<string, number>()
  private active = 0
  private bytes = 0
  private count = 0
  constructor(private readonly config: SchedulerConfig) {}
  run<T>(owner: string, bytes: number, work: () => Promise<T>, signal?: AbortSignal, cost = 1): Promise<T> {
    return this.runScoped({ owner, key: owner }, bytes, work, signal, cost)
  }
  runScoped<T>(scope: { owner: string; key: string }, bytes: number, work: () => Promise<T>, signal?: AbortSignal, cost = 1): Promise<T> {
    if (signal?.aborted) return Promise.reject(new OpenApiHttpError(499, "REQUEST_ABORTED", "请求已取消。"))
    if (this.count >= this.config.globalQueue) return Promise.reject(busy("GLOBAL_QUEUE_FULL", "服务繁忙，请稍后重试。"))
    if ((this.ownerPending.get(scope.owner) ?? 0) >= this.config.ownerQueue) return Promise.reject(busy("OWNER_QUEUE_FULL", "账号请求繁忙，请稍后重试。"))
    if ((this.queues.get(scope.key)?.length ?? 0) >= this.config.tableQueue) return Promise.reject(busy("TABLE_QUEUE_FULL", "当前数据表繁忙，请稍后重试。"))
    if (this.bytes + bytes > this.config.bytes) return Promise.reject(busy("QUEUE_BYTES_FULL", "服务繁忙，请稍后重试。"))
    return new Promise<T>((resolve, reject) => {
      const remove = (error: Error) => {
        const queue = this.queues.get(scope.key), index = queue?.indexOf(job) ?? -1
        if (index < 0 || !queue) return
        queue.splice(index, 1); this.bytes -= bytes; this.count--; this.decrementPending(scope.owner); job.clean(); reject(error)
        if (!queue.length) this.queues.delete(scope.key)
      }
      const abort = () => remove(new OpenApiHttpError(499, "REQUEST_ABORTED", "请求已取消。"))
      const timer = setTimeout(() => remove(busy("QUEUE_TIMEOUT", "排队超时，请稍后重试。")), this.config.waitMs)
      const job: Job = { owner: scope.owner, key: scope.key, bytes, cost: Math.max(1, Math.min(10, Math.ceil(cost))), reject,
        clean: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort) },
        invoke: async () => { try { resolve(await work()) } catch (e) { reject(e) } },
      }
      signal?.addEventListener("abort", abort, { once: true })
      const queue = this.queues.get(scope.key) ?? []; queue.push(job); this.queues.set(scope.key, queue)
      this.ownerPending.set(scope.owner, (this.ownerPending.get(scope.owner) ?? 0) + 1)
      this.bytes += bytes; this.count++; this.pump()
    })
  }
  private decrementPending(owner: string): void {
    const next = (this.ownerPending.get(owner) ?? 1) - 1
    if (next > 0) this.ownerPending.set(owner, next)
    else this.ownerPending.delete(owner)
  }
  private pump(): void {
    while (this.active < this.config.concurrency && this.count) {
      let chosen: string | undefined
      for (const [key, queue] of this.queues) {
        const job = queue[0]!
        if ((this.runningKeys.get(key) ?? 0) >= this.config.tableConcurrency) continue
        if ((this.runningOwners.get(job.owner) ?? 0) >= this.config.ownerConcurrency) continue
        if (!chosen || (this.credit.get(key) ?? 0) < (this.credit.get(chosen) ?? 0)) chosen = key
      }
      if (!chosen) break
      {
        const queue = this.queues.get(chosen)!, head = queue[0]!
        this.credit.set(chosen, (this.credit.get(chosen) ?? 0) + head.cost)
        this.queues.delete(chosen); if (queue.length > 1) this.queues.set(chosen, queue.slice(1))
        this.count--; this.bytes -= head.bytes; this.decrementPending(head.owner); head.clean(); this.active++
        this.runningKeys.set(chosen, (this.runningKeys.get(chosen) ?? 0) + 1)
        this.runningOwners.set(head.owner, (this.runningOwners.get(head.owner) ?? 0) + 1)
        void head.invoke().finally(() => {
          this.active--
          const keyCount = (this.runningKeys.get(chosen) ?? 1) - 1
          if (keyCount) this.runningKeys.set(chosen, keyCount)
          else { this.runningKeys.delete(chosen); if (!this.queues.has(chosen)) this.credit.delete(chosen) }
          const ownerCount = (this.runningOwners.get(head.owner) ?? 1) - 1
          if (ownerCount) this.runningOwners.set(head.owner, ownerCount)
          else this.runningOwners.delete(head.owner)
          this.pump()
        })
      }
    }
  }
}
