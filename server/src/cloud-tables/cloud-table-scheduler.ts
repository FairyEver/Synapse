import { OpenApiHttpError } from "../open-api/open-api.types"
export type SchedulerConfig = { concurrency: number; ownerConcurrency: number; ownerQueue: number; globalQueue: number; bytes: number; waitMs: number }
type Job = { owner: string; bytes: number; cost: number; invoke: () => Promise<void>; reject: (e: Error) => void; clean: () => void }
/** 一个进程内的有界owner队列；按已消耗工作量调度，等成本时轮转。 */
export class CloudTableScheduler {
  private queues = new Map<string, Job[]>()
  private running = new Map<string, number>()
  private credit = new Map<string, number>()
  private active = 0
  private bytes = 0
  private count = 0
  constructor(private readonly config: SchedulerConfig) {}
  run<T>(owner: string, bytes: number, work: () => Promise<T>, signal?: AbortSignal, cost = 1): Promise<T> {
    if (signal?.aborted) return Promise.reject(new OpenApiHttpError(499, "REQUEST_ABORTED", "请求已取消。"))
    if (this.count >= this.config.globalQueue || (this.queues.get(owner)?.length ?? 0) >= this.config.ownerQueue || this.bytes + bytes > this.config.bytes) return Promise.reject(new OpenApiHttpError(503, "SERVER_BUSY", "服务繁忙，请稍后重试。"))
    return new Promise<T>((resolve, reject) => {
      const remove = (error: Error) => {
        const queue = this.queues.get(owner), index = queue?.indexOf(job) ?? -1
        if (index < 0 || !queue) return
        queue.splice(index, 1); this.bytes -= bytes; this.count--; job.clean(); reject(error)
        if (!queue.length) this.queues.delete(owner)
      }
      const abort = () => remove(new OpenApiHttpError(499, "REQUEST_ABORTED", "请求已取消。"))
      const timer = setTimeout(() => remove(new OpenApiHttpError(503, "SERVER_BUSY", "排队超时，请稍后重试。")), this.config.waitMs)
      const job: Job = { owner, bytes, cost: Math.max(1, Math.min(10, Math.ceil(cost))), reject,
        clean: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort) },
        invoke: async () => { try { resolve(await work()) } catch (e) { reject(e) } },
      }
      signal?.addEventListener("abort", abort, { once: true })
      const queue = this.queues.get(owner) ?? []; queue.push(job); this.queues.set(owner, queue)
      this.bytes += bytes; this.count++; this.pump()
    })
  }
  private pump(): void {
    while (this.active < this.config.concurrency && this.count) {
      let chosen: [string, Job[]] | undefined
      for (const entry of this.queues) {
        const owner = entry[0]
        if ((this.running.get(owner) ?? 0) >= this.config.ownerConcurrency) continue
        if (!chosen || (this.credit.get(owner) ?? 0) < (this.credit.get(chosen[0]) ?? 0)) chosen = entry
      }
      if (!chosen) break
      {
        const [owner, queue] = chosen, head = queue[0]!
        this.credit.set(owner, (this.credit.get(owner) ?? 0) + head.cost)
        this.queues.delete(owner); if (queue.length > 1) this.queues.set(owner, queue.slice(1))
        this.count--; this.bytes -= head.bytes; head.clean(); this.active++
        this.running.set(owner, (this.running.get(owner) ?? 0) + 1)
        void head.invoke().finally(() => {
          this.active--; const n = (this.running.get(owner) ?? 1) - 1
          if (n) this.running.set(owner, n); else { this.running.delete(owner); if (!this.queues.has(owner)) this.credit.delete(owner) }
          this.pump()
        })
      }
    }
  }
}
