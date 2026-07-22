import { lstat } from "node:fs/promises"
import path from "node:path"

import { sanitizeError } from "../../electron/services/error-sanitize"
import { createMainLogger } from "../../electron/services/log-store"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import { truncateWithEllipsis } from "../../electron/services/workflow/workflow-utils"
import { workflowNodeLogContext } from "../log-context"
import type {
  NodeExecutionInput,
  NodeExecutionResult,
  NodeExecutor,
  WorkflowRuntimeContext,
} from "../types"
import type { OpenFileNodeConfig } from "./schema"

const logger = createMainLogger("workflow.node.open-file-executor")

export const openFileNodeExecutor: NodeExecutor<OpenFileNodeConfig> = {
  async execute(input: NodeExecutionInput<OpenFileNodeConfig>): Promise<NodeExecutionResult> {
    const startedAt = Date.now()
    const { context, runtimeDeps } = input
    const logContext = workflowNodeLogContext(context)
    const fail = (error: string): NodeExecutionResult => ({
      status: "failed",
      output: "",
      error,
      durationMs: Date.now() - startedAt,
    })
    const cancel = (): NodeExecutionResult => ({
      status: "cancelled",
      output: "",
      error: "文件打开已取消",
      durationMs: Date.now() - startedAt,
    })

    if (!runtimeDeps?.permissionGuard || !runtimeDeps.auditSink || !runtimeDeps.openPath) {
      return fail("默认应用打开能力不可用")
    }

    const filePath = interpolatePrompt(input.config.filePath, input.resolvedVariables)
    if (!filePath) return fail("文件路径必填")
    if (!path.isAbsolute(filePath)) return fail("文件路径必须是绝对路径")
    if (context.abortSignal.aborted) return cancel()

    const actor = context.actor ?? { kind: "system" as const, id: "workflow-engine" }
    const auditMetadata = createAuditMetadata(context)
    const permissionContext = { ...auditMetadata, source: "workflow.open_file" }

    input.onProgress?.("validating_file", "校验文件")
    const readRequest = {
      action: "fs.read.outside-userdata" as const,
      actor,
      resource: filePath,
      context: permissionContext,
    }
    const readPermission = await runtimeDeps.permissionGuard.check(readRequest)
    if (!readPermission.allowed) {
      runtimeDeps.auditSink.record({
        action: readRequest.action,
        actor,
        resource: filePath,
        outcome: "denied",
        metadata: { ...auditMetadata, policyId: readPermission.policyId },
      })
      logger.warn("open file read permission denied", {
        ...logContext,
        policyId: readPermission.policyId,
        filePathLength: filePath.length,
      })
      return fail("没有读取该文件的权限")
    }

    try {
      const stats = await lstat(filePath)
      if (stats.isSymbolicLink()) {
        recordFailure(input, "fs.read.outside-userdata", filePath, auditMetadata, "symbolic_link")
        return fail("不支持符号链接")
      }
      if (!stats.isFile()) {
        recordFailure(input, "fs.read.outside-userdata", filePath, auditMetadata, "not_regular_file")
        return fail("文件路径必须指向普通文件")
      }
    } catch (error) {
      const summary = summarizeError(error)
      recordFailure(input, "fs.read.outside-userdata", filePath, auditMetadata, "lstat_failed", summary)
      logger.warn("open file validation failed", {
        ...logContext,
        filePathLength: filePath.length,
        ...summary,
      })
      return fail("文件不存在或无法访问")
    }

    runtimeDeps.auditSink.record({
      action: readRequest.action,
      actor,
      resource: filePath,
      outcome: "allowed",
      metadata: auditMetadata,
    })

    const shellRequest = {
      action: "shell.exec" as const,
      actor,
      resource: filePath,
      context: permissionContext,
    }
    const shellPermission = await runtimeDeps.permissionGuard.check(shellRequest)
    if (!shellPermission.allowed) {
      runtimeDeps.auditSink.record({
        action: shellRequest.action,
        actor,
        resource: filePath,
        outcome: "denied",
        metadata: { ...auditMetadata, policyId: shellPermission.policyId },
      })
      logger.warn("open file shell permission denied", {
        ...logContext,
        policyId: shellPermission.policyId,
        filePathLength: filePath.length,
      })
      return fail("没有调用系统默认应用的权限")
    }

    if (context.abortSignal.aborted) return cancel()

    input.onProgress?.("opening_file", "打开文件")
    try {
      const errorText = await runtimeDeps.openPath(filePath)
      if (errorText !== "") {
        const safeError = truncateWithEllipsis(sanitizeError(errorText), 120)
        recordFailure(
          input,
          "shell.exec",
          filePath,
          auditMetadata,
          "open_path_failed",
          { errorLength: errorText.length },
        )
        logger.warn("open file request failed", {
          ...logContext,
          filePathLength: filePath.length,
          errorLength: errorText.length,
        })
        return fail(`系统未接受打开请求：${safeError}`)
      }

      runtimeDeps.auditSink.record({
        action: shellRequest.action,
        actor,
        resource: filePath,
        outcome: "allowed",
        metadata: auditMetadata,
      })
      logger.info("open file request submitted", {
        ...logContext,
        filePathLength: filePath.length,
      })
      return {
        status: "success",
        output: filePath,
        outputs: { path: filePath },
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const summary = summarizeError(error)
      recordFailure(input, "shell.exec", filePath, auditMetadata, "open_path_threw", summary)
      logger.warn("open file request threw", {
        ...logContext,
        filePathLength: filePath.length,
        ...summary,
      })
      return fail(`系统打开请求异常：${truncateWithEllipsis(sanitizeError(message), 120)}`)
    }
  },
}

function createAuditMetadata(context: WorkflowRuntimeContext): Record<string, unknown> {
  return {
    source: "workflow.open_file",
    workflowId: context.workflowId,
    runId: context.runId,
    nodeId: context.nodeId,
    automationId: context.automationId,
    automationRunId: context.automationRunId,
  }
}

function recordFailure(
  input: NodeExecutionInput<OpenFileNodeConfig>,
  action: "fs.read.outside-userdata" | "shell.exec",
  filePath: string,
  metadata: Record<string, unknown>,
  failureKind: string,
  detail?: Record<string, unknown>,
): void {
  input.runtimeDeps?.auditSink?.record({
    action,
    actor: input.context.actor ?? { kind: "system", id: "workflow-engine" },
    resource: filePath,
    outcome: "failed",
    metadata: { ...metadata, failureKind, ...detail },
  })
}

function summarizeError(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error)
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined
  return {
    errorName: error instanceof Error ? error.name : undefined,
    errorCode: code,
    errorLength: message.length,
  }
}
