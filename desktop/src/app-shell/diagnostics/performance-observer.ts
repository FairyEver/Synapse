import type { RendererLogger } from "./types"
import { guardedLog } from "./guard"

const LONG_TASK_THRESHOLD_MS = 100
const MEMORY_CHECK_INTERVAL_MS = 60_000
const MEMORY_WARN_RATIO = 0.85
const LONG_TASK_SUMMARY_INTERVAL_MS = 10_000

interface PerformanceMemory {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

export function installPerformanceObserver(logger: RendererLogger): () => void {
  let observer: PerformanceObserver | null = null
  let memoryTimer: ReturnType<typeof setInterval> | null = null
  let longTaskTimer: ReturnType<typeof setTimeout> | null = null
  let longTaskCount = 0
  let longTaskDurationMs = 0
  let longestTaskMs = 0

  const flushLongTasks = () => {
    longTaskTimer = null
    if (longTaskCount === 0) return
    guardedLog(logger, "warn", `长任务 ${longTaskCount} 次`, {
      count: longTaskCount,
      totalDurationMs: Math.round(longTaskDurationMs),
      maxDurationMs: Math.round(longestTaskMs),
    })
    longTaskCount = 0
    longTaskDurationMs = 0
    longestTaskMs = 0
  }

  if (typeof PerformanceObserver !== "undefined") {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > LONG_TASK_THRESHOLD_MS) {
            longTaskCount += 1
            longTaskDurationMs += entry.duration
            longestTaskMs = Math.max(longestTaskMs, entry.duration)
            if (!longTaskTimer) longTaskTimer = setTimeout(flushLongTasks, LONG_TASK_SUMMARY_INTERVAL_MS)
          }
        }
      })
      observer.observe({ type: "longtask", buffered: false })
    } catch {
      // longtask type not supported in this environment
    }
  }

  const perfWithMemory = performance as unknown as { memory?: PerformanceMemory }
  if (perfWithMemory.memory) {
    memoryTimer = setInterval(() => {
      const mem = perfWithMemory.memory
      if (!mem) return
      const ratio = mem.usedJSHeapSize / mem.jsHeapSizeLimit
      if (ratio > MEMORY_WARN_RATIO) {
        guardedLog(logger, "warn", `内存水位过高 ${Math.round(ratio * 100)}%`, {
          usedMB: Math.round(mem.usedJSHeapSize / 1024 / 1024),
          limitMB: Math.round(mem.jsHeapSizeLimit / 1024 / 1024),
          ratio: Math.round(ratio * 100),
        })
      }
    }, MEMORY_CHECK_INTERVAL_MS)
  }

  return () => {
    observer?.disconnect()
    if (memoryTimer !== null) clearInterval(memoryTimer)
    if (longTaskTimer !== null) clearTimeout(longTaskTimer)
  }
}
