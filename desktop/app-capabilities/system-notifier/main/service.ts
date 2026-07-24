import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { ActorIdentity, AuditSink } from "../../../electron/runtime/security"
import type { StructuredLogger } from "../../../electron/runtime/service-registry"
import type { SystemNotifierSettingsEntryV1 } from "../../../electron/runtime/data-repo/schemas/system-notifier"
import {
  SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
} from "../shared/capability"
import {
  defaultSystemNotifierSettings,
  systemNotifierSettingsPatchSchema,
  systemNotifierSettingsSchema,
  type SystemNotificationInput,
  type SystemNotificationResult,
  type SystemNotifierSettings,
  type SystemNotifierSettingsPatch,
} from "../shared/schema"
import {
  createNoopSystemNotificationAdapter,
  type SystemNotificationAdapter,
  type SystemNotifierFailureReason,
  type SystemNotifierFailureStage,
} from "./adapter"
import { SystemNotifierRateLimiter } from "./rate-limiter"

type SystemNotifierLogStage =
  | "settings_read"
  | "audit_record"
  | SystemNotifierFailureStage
  | "rate_limit"

type SystemNotifierLogReason =
  | SystemNotifierFailureReason
  | "repository_unavailable"
  | "read_failed"
  | "invalid_record"
  | "sink_unavailable"
  | "record_failed"
  | "suppressed"

export interface SystemNotifierTriggerContext {
  readonly source: string
  readonly actor: ActorIdentity
  readonly identityKey: string
  readonly clientId?: string
  readonly controllerInstanceId?: string
  readonly workflowId?: string
  readonly runId?: string
  readonly nodeId?: string
  readonly bypassEnabled?: boolean
}

export interface SystemNotifierServicePorts {
  readonly settings?: DataNamespace<SystemNotifierSettingsEntryV1>
  readonly auditSink?: AuditSink
  readonly adapter?: SystemNotificationAdapter
}

export interface SystemNotifierHealth {
  readonly status: "healthy" | "degraded"
  readonly reasons: readonly SystemNotifierDegradedReason[]
}

export type SystemNotifierDegradedReason =
  | "settings_unavailable"
  | "adapter_unavailable"
  | "adapter_failed"

export class SystemNotifierSettingsUnavailableError extends Error {
  constructor() {
    super("System notifier settings are unavailable.")
    this.name = "SystemNotifierSettingsUnavailableError"
  }
}

export class SystemNotifierService {
  private settingsPort?: DataNamespace<SystemNotifierSettingsEntryV1>
  private auditSink?: AuditSink
  private adapter: SystemNotificationAdapter = createNoopSystemNotificationAdapter()
  private snapshot: Readonly<SystemNotifierSettings> | null = null
  private hasValidSnapshot = false
  private settingsQueue: Promise<void> = Promise.resolve()
  private readonly degradedReasons = new Set<SystemNotifierDegradedReason>([
    "settings_unavailable",
    "adapter_unavailable",
  ])
  private readonly diagnostics: DiagnosticAggregator

  constructor(
    private readonly logger: Pick<StructuredLogger, "warn">,
    private readonly limiter = new SystemNotifierRateLimiter(),
    now: () => number = () => Date.now(),
  ) {
    this.diagnostics = new DiagnosticAggregator(logger, now)
  }

  async initialize(ports: SystemNotifierServicePorts): Promise<void> {
    this.settingsPort = ports.settings
    this.auditSink = ports.auditSink
    this.adapter = ports.adapter ?? createNoopSystemNotificationAdapter()
    if (this.adapter.kind === "electron") this.degradedReasons.delete("adapter_unavailable")
    else this.degradedReasons.add("adapter_unavailable")

    if (!this.settingsPort) {
      this.markSettingsUnavailable("repository_unavailable")
      return
    }
    await this.loadInitialSettings()
  }

  trigger(input: SystemNotificationInput, context: SystemNotifierTriggerContext): SystemNotificationResult {
    this.recordAudit(input, context)
    const settings = this.snapshot
    if (!context.bypassEnabled && (!settings || !settings.enabled)) return { success: true }

    if (!this.limiter.acquire(context.identityKey)) {
      this.diagnostics.record("rate_limit", "suppressed")
      return { success: true }
    }

    try {
      this.adapter.show({
        ...input,
        silent: settings?.silent ?? defaultSystemNotifierSettings.silent,
      })
    } catch {
      this.diagnostics.record("notification_show", "synchronous_exception")
    }
    return { success: true }
  }

  getSettings(): Promise<SystemNotifierSettings> {
    return this.runSettingsOperation(async () => {
      const port = this.requireSettingsPort()
      let stored: SystemNotifierSettingsEntryV1 | null
      try {
        stored = await port.getSingleton()
      } catch {
        if (!this.hasValidSnapshot) this.markSettingsUnavailable("read_failed")
        else this.diagnostics.record("settings_read", "read_failed")
        throw new SystemNotifierSettingsUnavailableError()
      }

      const settings = stored === null ? defaultSystemNotifierSettings : parseStoredSettings(stored)
      if (!settings) {
        this.markSettingsUnavailable("invalid_record")
        throw new SystemNotifierSettingsUnavailableError()
      }
      this.replaceSnapshot(settings)
      return settings
    })
  }

  updateSettings(patchInput: SystemNotifierSettingsPatch): Promise<SystemNotifierSettings> {
    return this.runSettingsOperation(async () => {
      const patch = systemNotifierSettingsPatchSchema.parse(patchInput)
      const port = this.requireSettingsPort()
      let stored: SystemNotifierSettingsEntryV1 | null
      try {
        stored = await port.getSingleton()
      } catch {
        this.diagnostics.record("settings_read", "read_failed")
        throw new SystemNotifierSettingsUnavailableError()
      }

      const current = stored === null ? defaultSystemNotifierSettings : parseStoredSettings(stored)
      if (!current) {
        this.markSettingsUnavailable("invalid_record")
        throw new SystemNotifierSettingsUnavailableError()
      }

      const next = systemNotifierSettingsSchema.parse({ ...current, ...patch })
      await port.setSingleton(next)
      this.replaceSnapshot(next)
      return next
    })
  }

  health(): SystemNotifierHealth {
    const reasons = [...this.degradedReasons].sort()
    return reasons.length === 0
      ? { status: "healthy", reasons }
      : { status: "degraded", reasons }
  }

  recordAdapterFailure(
    stage: SystemNotifierFailureStage,
    reason: SystemNotifierFailureReason,
  ): void {
    this.degradedReasons.add(stage === "adapter_init" ? "adapter_unavailable" : "adapter_failed")
    this.diagnostics.record(stage, reason)
  }

  dispose(): void {
    this.limiter.clear()
    this.adapter = createNoopSystemNotificationAdapter()
  }

  private async loadInitialSettings(): Promise<void> {
    try {
      await this.getSettings()
    } catch {
      this.snapshot = null
      this.hasValidSnapshot = false
      this.degradedReasons.add("settings_unavailable")
    }
  }

  private requireSettingsPort(): DataNamespace<SystemNotifierSettingsEntryV1> {
    if (!this.settingsPort) {
      this.markSettingsUnavailable("repository_unavailable")
      throw new SystemNotifierSettingsUnavailableError()
    }
    return this.settingsPort
  }

  private replaceSnapshot(settings: SystemNotifierSettings): void {
    this.snapshot = Object.freeze({ ...settings })
    this.hasValidSnapshot = true
    this.degradedReasons.delete("settings_unavailable")
  }

  private markSettingsUnavailable(
    reason: "repository_unavailable" | "read_failed" | "invalid_record",
  ): void {
    this.snapshot = null
    this.hasValidSnapshot = false
    this.degradedReasons.add("settings_unavailable")
    this.diagnostics.record("settings_read", reason)
  }

  private runSettingsOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.settingsQueue.then(operation, operation)
    this.settingsQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private recordAudit(input: SystemNotificationInput, context: SystemNotifierTriggerContext): void {
    if (!this.auditSink) {
      this.diagnostics.record("audit_record", "sink_unavailable")
      return
    }
    try {
      this.auditSink.record({
        action: "notification.trigger",
        actor: context.actor,
        resource: SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
        outcome: "allowed",
        metadata: {
          source: context.source,
          titleCodePointLength: [...input.title].length,
          bodyCodePointLength: [...input.body].length,
          ...(context.clientId ? { clientId: context.clientId } : {}),
          ...(context.controllerInstanceId ? { controllerInstanceId: context.controllerInstanceId } : {}),
          ...(context.workflowId ? { workflowId: context.workflowId } : {}),
          ...(context.runId ? { runId: context.runId } : {}),
          ...(context.nodeId ? { nodeId: context.nodeId } : {}),
        },
      })
    } catch {
      this.diagnostics.record("audit_record", "record_failed")
    }
  }
}

function parseStoredSettings(value: unknown): SystemNotifierSettings | null {
  const result = systemNotifierSettingsSchema.safeParse(value)
  return result.success ? result.data : null
}

class DiagnosticAggregator {
  private readonly counts = new Map<string, number>()
  private lastFlushAt: number | null = null

  constructor(
    private readonly logger: Pick<StructuredLogger, "warn">,
    private readonly now: () => number,
  ) {}

  record(stage: SystemNotifierLogStage, reason: SystemNotifierLogReason): void {
    const key = `${stage}:${reason}`
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1)
    const current = this.now()
    if (this.lastFlushAt !== null && current - this.lastFlushAt < 60_000) return
    this.lastFlushAt = current
    for (const [entry, count] of this.counts) {
      const separator = entry.indexOf(":")
      this.logger.warn("System notifier diagnostic summary.", {
        stage: entry.slice(0, separator),
        reason: entry.slice(separator + 1),
        count,
      })
    }
    this.counts.clear()
  }
}
