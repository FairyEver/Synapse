import type {
  ActorIdentity,
  AuditSink,
  PermissionAction,
} from "../../../electron/runtime/security"
import type { StructuredLogger } from "../../../electron/runtime/service-registry"
import {
  CLIPBOARD_TEXT_READ_CAPABILITY_ID,
  CLIPBOARD_TEXT_WRITE_CAPABILITY_ID,
} from "../shared/capability"
import { ClipboardError } from "../shared/errors"
import { validateClipboardReadText } from "../shared/schema"
import {
  createUnavailableClipboardAdapter,
  type ClipboardAdapter,
} from "./adapter"

export interface ClipboardOperationContext {
  readonly source: "workflow"
  readonly actor: ActorIdentity
  readonly workflowId: string
  readonly runId: string
  readonly nodeId: string
}

export interface ClipboardHealth {
  readonly status: "healthy" | "degraded"
  readonly reason?: "adapter_unavailable"
}

type ClipboardLogStage =
  | "adapter_init"
  | "clipboard_read"
  | "clipboard_write"
  | "audit_record"

type ClipboardLogReason =
  | "adapter_unavailable"
  | "native_exception"
  | "invalid_unicode"
  | "sink_unavailable"
  | "sink_failure"

export class ClipboardService {
  private readonly adapter: ClipboardAdapter

  constructor(
    adapter: ClipboardAdapter | undefined,
    private readonly auditSink: AuditSink | undefined,
    private readonly logger: Pick<StructuredLogger, "warn">,
  ) {
    this.adapter = adapter ?? createUnavailableClipboardAdapter()
    if (this.adapter.kind === "unavailable") {
      this.warn("adapter_init", "adapter_unavailable")
    }
  }

  read(context: ClipboardOperationContext): { readonly text: string } {
    let text: string
    try {
      text = this.adapter.readText()
    } catch {
      this.warn(
        "clipboard_read",
        this.adapter.kind === "unavailable"
          ? "adapter_unavailable"
          : "native_exception",
      )
      this.recordAudit("clipboard.read", CLIPBOARD_TEXT_READ_CAPABILITY_ID, "failed", context, "READ_FAILED")
      throw new ClipboardError("READ_FAILED")
    }

    const validation = validateClipboardReadText(text)
    if (!validation.ok) {
      const code = validation.error.code === "TEXT_TOO_LARGE"
        ? "TEXT_TOO_LARGE"
        : "READ_FAILED"
      if (
        validation.error.code === "INVALID_INPUT"
        && validation.error.data?.reason === "invalid_unicode"
      ) {
        this.warn("clipboard_read", "invalid_unicode")
      }
      this.recordAudit("clipboard.read", CLIPBOARD_TEXT_READ_CAPABILITY_ID, "failed", context, code)
      throw new ClipboardError(code)
    }

    this.recordAudit("clipboard.read", CLIPBOARD_TEXT_READ_CAPABILITY_ID, "allowed", context)
    return { text: validation.text }
  }

  write(text: string, context: ClipboardOperationContext): { readonly success: true } {
    try {
      this.adapter.writeText(text)
    } catch {
      this.warn(
        "clipboard_write",
        this.adapter.kind === "unavailable"
          ? "adapter_unavailable"
          : "native_exception",
      )
      this.recordAudit("clipboard.write", CLIPBOARD_TEXT_WRITE_CAPABILITY_ID, "failed", context, "WRITE_FAILED")
      throw new ClipboardError("WRITE_FAILED")
    }

    this.recordAudit("clipboard.write", CLIPBOARD_TEXT_WRITE_CAPABILITY_ID, "allowed", context)
    return { success: true }
  }

  health(): ClipboardHealth {
    return this.adapter.kind === "electron"
      ? { status: "healthy" }
      : { status: "degraded", reason: "adapter_unavailable" }
  }

  private recordAudit(
    action: Extract<PermissionAction, "clipboard.read" | "clipboard.write">,
    resource: string,
    outcome: "allowed" | "failed",
    context: ClipboardOperationContext,
    errorCode?: string,
  ): void {
    if (!this.auditSink) {
      this.warn("audit_record", "sink_unavailable")
      return
    }
    try {
      this.auditSink.record({
        action,
        actor: context.actor,
        resource,
        outcome,
        metadata: {
          source: context.source,
          workflowId: context.workflowId,
          runId: context.runId,
          nodeId: context.nodeId,
          ...(errorCode ? { errorCode } : {}),
        },
      })
    } catch {
      this.warn("audit_record", "sink_failure")
    }
  }

  private warn(stage: ClipboardLogStage, reason: ClipboardLogReason): void {
    this.logger.warn("Clipboard operation degraded.", { stage, reason })
  }
}
