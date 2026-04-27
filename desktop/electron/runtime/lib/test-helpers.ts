/**
 * Phase 0 — 共享测试 helper.
 *
 * 单测不应该重复实现 noop logger、stub safeStorage 之类。这里集中管理。
 * 仅供 vitest 使用；不会进入产物（tsconfig.test.json 包含但 build:electron 排除）。
 */

import type { StructuredLogger } from "../service-registry/types"

export interface TestLogRecord {
  readonly level: "trace" | "debug" | "info" | "warn" | "error" | "fatal"
  readonly message: string
  readonly meta?: unknown
}

/**
 * 满足 StructuredLogger 占位接口的 noop logger。
 * 每个 child(prefix) 返回同一个实例（避免内存增长）。
 */
export function createNoopLogger(): StructuredLogger {
  const noop = () => {
    /* intentional no-op */
  }
  const logger: StructuredLogger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  }
  return logger
}

export function createRecordingLogger(): StructuredLogger & { readonly records: TestLogRecord[] } {
  const records: TestLogRecord[] = []
  const logger: StructuredLogger & { readonly records: TestLogRecord[] } = {
    records,
    trace: (message, meta) => records.push({ level: "trace", message, meta }),
    debug: (message, meta) => records.push({ level: "debug", message, meta }),
    info: (message, meta) => records.push({ level: "info", message, meta }),
    warn: (message, meta) => records.push({ level: "warn", message, meta }),
    error: (message, meta) => records.push({ level: "error", message, meta }),
    fatal: (message, meta) => records.push({ level: "fatal", message, meta }),
    child: () => logger,
  }
  return logger
}
