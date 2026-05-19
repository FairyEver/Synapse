/**
 * Phase 0.6 — DiagnosticsCollector.
 * SPEC §15.4.
 *
 * Bundles up: recent log records (caller-provided), registry inspect outputs,
 * data-repo inspect, metrics snapshot, current project containers list,
 * system info. Excludes any secret material per SPEC §15.5.
 */

import type { LogRecord } from "../logging/logger"
import type { ServiceInspectEntry } from "../service-registry/types"
import type { DataRepositoryInspectEntry } from "../data-repo/types"
import type { MetricsSnapshot } from "./metrics"
import type { OverallHealth } from "./health"

export interface DiagnosticsArtifact {
  readonly generatedAt: string
  readonly system: { os: string; node: string; pid: number }
  readonly services: readonly ServiceInspectEntry[]
  readonly dataRepo: readonly DataRepositoryInspectEntry[]
  readonly metrics: MetricsSnapshot
  readonly health: OverallHealth
  readonly projectContainers: readonly { projectId: string; openedAt: string }[]
  readonly recentLogs: readonly LogRecord[]
}

export interface DiagnosticsCollectorDeps {
  readonly recentLogs: () => readonly LogRecord[]
  readonly inspectServices: () => readonly ServiceInspectEntry[]
  readonly inspectDataRepo: () => readonly DataRepositoryInspectEntry[]
  readonly metricsSnapshot: () => MetricsSnapshot
  readonly checkHealth: () => Promise<OverallHealth>
  readonly listProjectContainers: () => readonly { projectId: string; openedAt: string }[]
  readonly redact?: (record: LogRecord) => LogRecord
}

export class DiagnosticsCollector {
  constructor(private readonly deps: DiagnosticsCollectorDeps) {}

  async collect(): Promise<DiagnosticsArtifact> {
    const redact = this.deps.redact ?? defaultRedact
    return {
      generatedAt: new Date().toISOString(),
      system: {
        os: `${process.platform} ${process.arch}`,
        node: process.version,
        pid: process.pid,
      },
      services: this.deps.inspectServices(),
      dataRepo: this.deps.inspectDataRepo(),
      metrics: this.deps.metricsSnapshot(),
      health: await this.deps.checkHealth(),
      projectContainers: this.deps.listProjectContainers(),
      recentLogs: this.deps.recentLogs().map(redact),
    }
  }
}

const SECRET_KEY_RE = /(key|token|secret|password|authorization)/i

function defaultRedact(record: LogRecord): LogRecord {
  return {
    ...record,
    ...(record.context ? { context: redactContext(record.context) } : {}),
    ...(record.error ? { error: redactLogError(record.error) } : {}),
  }
}

function redactContext(context: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(context)) {
    redacted[k] = SECRET_KEY_RE.test(k) ? "[REDACTED]" : redactValue(v, 0)
  }
  return redacted
}

const MAX_REDACT_DEPTH = 8

function redactValue(value: unknown, depth: number): unknown {
  if (depth >= MAX_REDACT_DEPTH) return "[REDACTED deep]"
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1))
  if (typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = SECRET_KEY_RE.test(k) ? "[REDACTED]" : redactValue(v, depth + 1)
    }
    return result
  }
  return value
}

function redactLogError(error: NonNullable<LogRecord["error"]>): NonNullable<LogRecord["error"]> {
  return {
    name: error.name,
    message: `[REDACTED ${error.message.length} chars]`,
    ...(error.stack ? { stack: `[REDACTED ${error.stack.length} chars]` } : {}),
  }
}

export function createDiagnosticsCollector(deps: DiagnosticsCollectorDeps): DiagnosticsCollector {
  return new DiagnosticsCollector(deps)
}
