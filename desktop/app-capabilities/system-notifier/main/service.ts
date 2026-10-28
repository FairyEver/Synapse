import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { DesktopNotificationOutcome } from "@synapse/shared" with { "resolution-mode": "import" }
import type { ActorIdentity, AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import type { StructuredLogger } from "../../../electron/runtime/service-registry"
import type { SystemNotifierSettingsEntryV3 } from "../../../electron/runtime/data-repo/schemas/system-notifier"
import {
  SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
} from "../shared/capability"
import {
  defaultSystemNotifierSettings,
  systemNotificationInvalid,
  systemNotifierSettingsPatchSchema,
  systemNotifierSettingsSchema,
  systemNotifierTestNotification,
  validateSystemNotificationInput,
  type NotificationImageUploadOutcome,
  type SystemNotificationInput,
  type SystemNotificationInputValidation,
  type SystemNotificationInvalidInput,
  type SystemNotificationInvalidReason,
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
import { readNotificationImageFile } from "./image"
import { SystemNotifierRateLimiter } from "./rate-limiter"

type SystemNotifierLogStage =
  | "settings_read"
  | "audit_record"
  | "notification_sync"
  | SystemNotifierFailureStage
  | "rate_limit"

type SystemNotifierLogReason =
  | SystemNotifierFailureReason
  | "repository_unavailable"
  | "read_failed"
  | "invalid_record"
  | "sink_unavailable"
  | "record_failed"
  | "disabled"
  | "settings_unavailable"
  | "not_signed_in"
  | "offline"
  | "sync_failed"
  // 图片暂存被服务端拒绝，消息本身仍然照常发出去（只是没有图）。
  | "failed"
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
}

export interface SystemNotifierServicePorts {
  readonly settings?: DataNamespace<SystemNotifierSettingsEntryV3>
  readonly auditSink?: AuditSink
  readonly adapter?: SystemNotificationAdapter
  /**
   * 把通知发到账号消息中心。返回它为什么没发出去（未登录、离线）或已经发出；请求失败抛错。
   */
  readonly sync?: (input: SystemNotificationInput) => Promise<DesktopNotificationOutcome>
  /** 把 `imagePath` 指向的图片暂存到服务端；缺省表示这条能力没有上传通道。 */
  readonly uploadImage?: (input: { bytes: Buffer; mimeType: string }) => Promise<NotificationImageUploadOutcome>
  readonly permissionGuard?: PermissionGuard
}

/** 「发送测试通知」用的固定 UI 身份，与任何触发来源都不共用配额。 */
const SYSTEM_APP_TEST_CONTEXT = {
  source: "system-app-test",
  actor: { kind: "user", id: "system-app:system-notifier" },
  identityKey: "system-app-test\u0000system-notifier",
} as const satisfies SystemNotifierTriggerContext

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

/**
 * `sync` 端口的入参形状：把一条系统通知映射成一次账号写入。
 *
 * 单独提出来是因为这里是这条链路上唯一逐字段挑的地方 —— `trigger` 与 `sendToAccount`
 * 都原样转发整个 input，只有它可能把新字段挑漏。挑漏一个，那个字段就永远到不了手机，
 * 而且没有任何运行时症状可以追。提成纯函数，才有地方钉住它。
 */
export function systemNotificationAccountWrite(input: SystemNotificationInput): {
  readonly source: "system-notifier"
  readonly title: string
  readonly body: string
  readonly group?: string
  readonly url?: string
  readonly copyOnTap?: boolean
  readonly imageId?: string
} {
  return {
    source: "system-notifier",
    title: input.title,
    body: input.body,
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.group !== undefined ? { group: input.group } : {}),
    ...(input.copyOnTap === true ? { copyOnTap: true } : {}),
    ...(input.imageId !== undefined ? { imageId: input.imageId } : {}),
  }
}

export class SystemNotifierService {
  private settingsPort?: DataNamespace<SystemNotifierSettingsEntryV3>
  private auditSink?: AuditSink
  private adapter: SystemNotificationAdapter = createNoopSystemNotificationAdapter()
  private sync?: (input: SystemNotificationInput) => Promise<DesktopNotificationOutcome>
  private uploadImage?: SystemNotifierServicePorts["uploadImage"]
  private permissionGuard?: PermissionGuard
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
    this.sync = ports.sync
    this.uploadImage = ports.uploadImage
    this.permissionGuard = ports.permissionGuard
    if (this.adapter.kind === "electron") this.degradedReasons.delete("adapter_unavailable")
    else this.degradedReasons.add("adapter_unavailable")

    if (!this.settingsPort) {
      this.markSettingsUnavailable("repository_unavailable")
      return
    }
    await this.loadInitialSettings()
  }

  /**
   * 触发前的异步准备：把本机图片读出来、传到服务端，换成消息能挂的 `imageId`。
   *
   * 只有这里会碰文件系统，`trigger` 保持同步。成功时返回的输入里没有 `imagePath` ——
   * 本机路径属于发起的那台电脑，没有任何理由往账号里写。
   */
  async prepare(input: SystemNotificationInput, context: SystemNotifierTriggerContext): Promise<SystemNotificationInputValidation> {
    if (input.imagePath === undefined) return { ok: true, data: input }
    const settings = this.snapshot
    if (settings?.sendEnabled !== true) {
      this.diagnostics.record("notification_sync", "disabled")
      return { ok: true, data: withoutImagePath(input) }
    }
    const read = await readNotificationImageFile({
      filePath: input.imagePath,
      actor: context.actor,
      permissionGuard: this.permissionGuard,
      auditSink: this.auditSink,
      metadata: { source: context.source, capabilityAction: SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID },
    })
    if (!read.ok) return invalidImage(read.reason)
    const uploaded = await this.uploadImage?.({ bytes: read.bytes, mimeType: read.mimeType })
    if (!uploaded || uploaded.status === "failed" || uploaded.status === "not_signed_in" || uploaded.status === "offline") {
      this.diagnostics.record("notification_sync", uploaded?.status ?? "sync_failed")
      return { ok: true, data: withoutImagePath(input) }
    }
    if (uploaded.status === "service_outdated") return invalidImage("service_outdated")
    return { ok: true, data: { ...withoutImagePath(input), imageId: uploaded.imageId } }
  }

  /**
   * 一次触发只做一件事：把通知发到账号消息中心。
   *
   * 本机弹窗不在这里 —— 它由「收到那条消息」这件事产生（`live-connection-service` 调
   * `presentAccountNotification`），发起的那台电脑和别的电脑走的是同一条路。发不出去就是
   * 发不出去：未登录或离线时账号里不会有这条消息，也就没有任何设备会显示它。
   */
  trigger(input: SystemNotificationInput, context: SystemNotifierTriggerContext): SystemNotificationResult {
    this.recordAudit(input, context)
    const settings = this.snapshot
    if (!settings) {
      this.diagnostics.record("notification_sync", "settings_unavailable")
      return { success: true }
    }
    if (!settings.sendEnabled) {
      this.diagnostics.record("notification_sync", "disabled")
      return { success: true }
    }

    if (!this.limiter.acquire(context.identityKey)) {
      this.diagnostics.record("rate_limit", "suppressed")
      return { success: true }
    }

    void this.sendToAccount(input)
    return { success: true }
  }

  /**
   * 发出去了就结束；没发出去的每一个原因都留一条固定诊断。
   *
   * 成功响应不因此改变——调用方仍然分不出「发了」和「没发」，那是这条能力的设计。能分出的
   * 是本地诊断：用户问「AI 说通知我了但我没收到」时，这里能答出是哪一种。
   */
  private async sendToAccount(input: SystemNotificationInput): Promise<void> {
    if (!this.sync) return
    try {
      const outcome = await this.sync(input)
      if (outcome !== "sent") this.diagnostics.record("notification_sync", outcome)
    } catch {
      this.diagnostics.record("notification_sync", "sync_failed")
    }
  }

  /**
   * 这台电脑收到一条账号消息时的原生呈现，由实时连接在收到广播并取回消息后调用。
   *
   * 本机通知关着、或设置读不出来时都不弹：`localEnabled` / `silent` 描述的就是这台电脑的
   * 呈现，这是触发之后这台电脑唯一会弹原生通知的地方。
   */
  presentAccountNotification(input: SystemNotificationInput): void {
    const settings = this.snapshot
    if (settings?.localEnabled !== true) return
    this.show({ ...input, silent: settings.silent })
  }

  /**
   * 「发送测试通知」：只看本机，绝不发到账号消息中心。
   *
   * 与本机通知开关无关 —— 关着的时候仍然要能试出来系统权限、unsupported 这类问题；
   * 静音值沿用设置，读不出来时用默认值。
   */
  presentTestNotification(): SystemNotificationResult {
    const validation = validateSystemNotificationInput(systemNotifierTestNotification)
    if (!validation.ok) throw new Error("System notifier test input invariant failed.")
    this.recordAudit(validation.data, SYSTEM_APP_TEST_CONTEXT)
    if (!this.limiter.acquire(SYSTEM_APP_TEST_CONTEXT.identityKey)) {
      this.diagnostics.record("rate_limit", "suppressed")
      return { success: true }
    }
    this.show({
      ...validation.data,
      silent: this.snapshot?.silent ?? defaultSystemNotifierSettings.silent,
    })
    return { success: true }
  }

  private show(input: SystemNotificationInput & { readonly silent: boolean }): void {
    try {
      this.adapter.show(input)
    } catch {
      this.diagnostics.record("notification_show", "synchronous_exception")
    }
  }

  getSettings(): Promise<SystemNotifierSettings> {
    return this.runSettingsOperation(async () => {
      const port = this.requireSettingsPort()
      let stored: SystemNotifierSettingsEntryV3 | null
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
      let stored: SystemNotifierSettingsEntryV3 | null
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

  private requireSettingsPort(): DataNamespace<SystemNotifierSettingsEntryV3> {
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

/** 图片相关的拒绝一律挂在 `imagePath` 上：调用方只需要知道「这张图用不了」。 */
function invalidImage(reason: SystemNotificationInvalidReason): SystemNotificationInvalidInput {
  return systemNotificationInvalid("imagePath", reason)
}

/** 暂存之后本机路径就没有意义了：消息只带服务端 id，账号里不写发起电脑的路径。 */
function withoutImagePath(input: SystemNotificationInput): SystemNotificationInput {
  const rest = { ...input }
  delete rest.imagePath
  return rest
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
