import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type {
  AgentArtifactEntryV1,
  AgentEventEntryV1,
  AgentUsageEntryV1,
  ConversationEntryV1,
  DataNamespace,
} from "../../runtime/data-repo"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type {
  SynapseAgentPendingPermission,
  SynapseAgentStatus,
  SynapseAgentTimelineItem,
  SynapseAgentTimelineResult,
} from "../../../src/types/agent"
import { formatAgentTranscript } from "../../../src/lib/agent-transcript"
import { historyRecordToTimelineItem } from "../../../src/lib/agent-timeline"
import { REDACTED, redactSensitiveValue } from "./redaction"

const EXPORT_SOURCE = "agent.exportConversationBundle"
const MAX_EXPORT_FILE_NAME_SEGMENT_LENGTH = 80

export interface AgentConversationExportRequest {
  readonly projectId: string
  readonly sessionKey?: string
  readonly conversationId: string
}

export interface AgentConversationExportResult {
  readonly success: boolean
  readonly filePath?: string
  readonly fileCount?: number
}

interface AgentConversationLiveState {
  readonly status?: SynapseAgentStatus
  readonly pendingPermissions?: readonly SynapseAgentPendingPermission[]
}

interface AgentConversationExportServiceDeps {
  readonly conversations: DataNamespace<ConversationEntryV1>
  readonly agentEvents: DataNamespace<AgentEventEntryV1>
  readonly agentUsage: DataNamespace<AgentUsageEntryV1>
  readonly agentArtifacts?: DataNamespace<AgentArtifactEntryV1>
  readonly chooseSavePath: (defaultFileName: string) => Promise<string | null>
  readonly createZipArchive: (sourceDirectoryPath: string, outputFilePath: string) => Promise<void>
  readonly makeTempDir?: (prefix: string) => Promise<string>
  readonly writeTextFile?: (targetPath: string, content: string) => Promise<void>
  readonly removePath?: (targetPath: string) => Promise<void>
  readonly getTimeline?: (request: AgentConversationExportRequest) => Promise<SynapseAgentTimelineResult>
  readonly getLiveState?: (request: AgentConversationExportRequest) => Promise<AgentConversationLiveState>
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly now?: () => Date
  readonly logger?: {
    warn(message: string, metadata?: Record<string, unknown>): void
  }
}

interface BundleManifest {
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly projectId: string
  readonly conversationId: string
  readonly sessionKey?: string
  readonly redaction: {
    readonly enabled: true
    readonly marker: "[redacted]"
    readonly description: string
  }
  readonly attachments: {
    readonly binaryIncluded: false
    readonly description: string
  }
  readonly included: string[]
  readonly skipped: Array<{ path: string; reason: string }>
}

interface UsageSummary {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

interface AttachmentExportMessage {
  readonly messageIndex: number
  readonly role: ConversationEntryV1["history"][number]["role"]
  readonly timestamp: string
  readonly contentPreview: string
  readonly attachments: readonly unknown[]
}

interface AttachmentExportIndex {
  readonly schemaVersion: 1
  readonly binaryIncluded: false
  readonly messageCount: number
  readonly attachmentCount: number
  readonly messages: readonly AttachmentExportMessage[]
}

class AgentConversationExportService {
  private readonly deps: AgentConversationExportServiceDeps

  constructor(deps: AgentConversationExportServiceDeps) {
    this.deps = deps
  }

  async exportBundle(request: AgentConversationExportRequest): Promise<AgentConversationExportResult> {
    const conversation = await this.deps.conversations.get(request.conversationId)
    if (!conversation || conversation.projectId !== request.projectId) {
      throw new Error("找不到 Agent 会话。")
    }

    const defaultFileName = createDefaultFileName(
      conversation.name ?? request.conversationId,
      this.now(),
    )
    const outputPath = await this.deps.chooseSavePath(defaultFileName)
    if (!outputPath) return { success: false }

    await this.checkWritePermission(outputPath, request)

    const generatedAt = this.now().toISOString()
    const folderName = defaultFileName.replace(/\.zip$/i, "")
    const stagingRoot = await this.makeTempDir("synapse-agent-conversation-")
    const packageRoot = path.resolve(stagingRoot, folderName)
    const included: string[] = []
    const skipped: Array<{ path: string; reason: string }> = []

    try {
      await mkdir(packageRoot, { recursive: true })

      const timeline = await this.collectTimeline(request, conversation, skipped)
      const agentEvents = await this.collectRows(
        "agent-events.json",
        () => this.deps.agentEvents.list({
          projectId: request.projectId,
          conversationId: request.conversationId,
        } as Partial<AgentEventEntryV1>),
        skipped,
      )
      const agentUsage = await this.collectRows(
        "agent-usage.json",
        () => this.deps.agentUsage.list({
          projectId: request.projectId,
          conversationId: request.conversationId,
        } as Partial<AgentUsageEntryV1>),
        skipped,
      )
      const liveState = await this.collectLiveState(request, skipped)
      const summary = buildSummary({
        conversation,
        timeline,
        agentEvents,
        agentUsage,
      })

      await this.writeJson(packageRoot, "conversation.json", conversation, included)
      await this.writeJson(packageRoot, "attachments.json", buildAttachmentExportIndex(conversation), included)
      await this.writeJson(packageRoot, "timeline.json", {
        projectId: request.projectId,
        sessionKey: request.sessionKey ?? conversation.sessionKey,
        conversationId: request.conversationId,
        entries: timeline,
      }, included)
      await this.writeJson(packageRoot, "agent-events.json", agentEvents, included)
      await this.writeJson(packageRoot, "agent-usage.json", agentUsage, included)
      if (this.deps.agentArtifacts) {
        const agentArtifacts = await this.collectRows(
          "agent-artifacts.json",
          () => this.deps.agentArtifacts!.list({
            projectId: request.projectId,
            conversationId: request.conversationId,
          } as Partial<AgentArtifactEntryV1>),
          skipped,
        )
        await this.writeAgentArtifacts(packageRoot, agentArtifacts, included, skipped)
      }
      await this.writeJson(packageRoot, "summary.json", summary, included)
      await this.writeText(packageRoot, "transcript.md", `${formatAgentTranscript(timeline)}\n`, included)
      await this.writeJson(packageRoot, "live-state.json", liveState ?? {}, included)

      const manifest: BundleManifest = {
        schemaVersion: 1,
        generatedAt,
        projectId: request.projectId,
        conversationId: request.conversationId,
        sessionKey: request.sessionKey ?? conversation.sessionKey,
        redaction: {
          enabled: true,
          marker: "[redacted]",
          description: "Sensitive tokens, session keys, API keys, Authorization/Bearer headers, cookies, passwords, credentials, and secrets are redacted.",
        },
        attachments: {
          binaryIncluded: false,
          description: "User input attachment bytes are not exported. Agent output artifacts are listed in agent-artifacts.json and copied under artifacts/ when available.",
        },
        included,
        skipped,
      }
      await this.writeJson(packageRoot, "manifest.json", manifest)

      await this.deps.createZipArchive(packageRoot, outputPath)
      this.recordAudit("allowed", outputPath, {
        ...auditRequestMetadata(request),
        includedCount: included.length,
        skippedCount: skipped.length,
      })
      return { success: true, filePath: outputPath, fileCount: included.length }
    } catch (error) {
      this.recordAudit("failed", outputPath, {
        ...auditRequestMetadata(request),
        ...errorAuditMetadata(error),
      })
      throw error
    } finally {
      await this.removePath(stagingRoot).catch((error: unknown) => {
        this.deps.logger?.warn("Agent conversation export staging cleanup failed.", {
          boundary: "agent.conversation-export.cleanup",
          stagingRoot,
          ...errorAuditMetadata(error),
        })
      })
    }
  }

  private async collectTimeline(
    request: AgentConversationExportRequest,
    conversation: ConversationEntryV1,
    skipped: Array<{ path: string; reason: string }>,
  ): Promise<SynapseAgentTimelineItem[]> {
    if (this.deps.getTimeline) {
      try {
        const result = await this.deps.getTimeline(request)
        return sanitizeExportValue(result.entries) as SynapseAgentTimelineItem[]
      } catch (error) {
        skipped.push({ path: "timeline.runtime", reason: "runtime lookup failed; conversation history fallback was used" })
        this.deps.logger?.warn("Agent conversation export timeline runtime lookup failed.", {
          boundary: "agent.conversation-export.timeline",
          ...auditRequestMetadata(request),
          ...errorAuditMetadata(error),
        })
      }
    }
    return sanitizeExportValue(conversation.history.map((entry, index) =>
      historyRecordToTimelineItem(conversation.id, entry, index, conversation.agentType))) as SynapseAgentTimelineItem[]
  }

  private async collectRows<T extends { readonly createdAt?: string; readonly id: string }>(
    exportPath: string,
    collect: () => Promise<T[]>,
    skipped: Array<{ path: string; reason: string }>,
  ): Promise<T[]> {
    try {
      return (sanitizeExportValue((await collect()).sort(compareRows)) as T[])
    } catch (error) {
      skipped.push({ path: exportPath, reason: "read failed" })
      this.deps.logger?.warn("Agent conversation export namespace read failed.", {
        boundary: "agent.conversation-export.namespace",
        exportPath,
        ...errorAuditMetadata(error),
      })
      return []
    }
  }

  private async collectLiveState(
    request: AgentConversationExportRequest,
    skipped: Array<{ path: string; reason: string }>,
  ): Promise<AgentConversationLiveState | null> {
    if (!this.deps.getLiveState) {
      skipped.push({ path: "live-state.json", reason: "live state collector is not configured" })
      return null
    }
    try {
      return sanitizeExportValue(await this.deps.getLiveState(request)) as AgentConversationLiveState
    } catch (error) {
      skipped.push({ path: "live-state.json", reason: "runtime lookup failed" })
      this.deps.logger?.warn("Agent conversation export live state lookup failed.", {
        boundary: "agent.conversation-export.live-state",
        ...auditRequestMetadata(request),
        ...errorAuditMetadata(error),
      })
      return null
    }
  }

  private async writeJson(
    packageRoot: string,
    relativePath: string,
    value: unknown,
    included?: string[],
  ): Promise<void> {
    await this.writeText(packageRoot, relativePath, `${JSON.stringify(sanitizeExportValue(value), null, 2)}\n`, included)
  }

  private async writeText(
    packageRoot: string,
    relativePath: string,
    content: string,
    included?: string[],
  ): Promise<void> {
    await this.writeTextFile(path.join(packageRoot, relativePath), normalizeExportText(content))
    included?.push(relativePath)
  }

  private async writeAgentArtifacts(
    packageRoot: string,
    artifacts: readonly AgentArtifactEntryV1[],
    included: string[],
    skipped: Array<{ path: string; reason: string }>,
  ): Promise<void> {
    const exported = artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      mimeType: artifact.mimeType,
      byteSize: artifact.byteSize,
      sha256: artifact.sha256,
      toolUseId: artifact.toolUseId,
      toolName: artifact.toolName,
      createdAt: artifact.createdAt,
      relativePath: `artifacts/${artifact.id}.${extensionForMimeType(artifact.mimeType)}`,
    }))
    await this.writeJson(packageRoot, "agent-artifacts.json", {
      schemaVersion: 1,
      binaryIncluded: true,
      artifacts: exported,
    }, included)

    for (const artifact of artifacts) {
      const relativePath = `artifacts/${artifact.id}.${extensionForMimeType(artifact.mimeType)}`
      try {
        await mkdir(path.dirname(path.join(packageRoot, relativePath)), { recursive: true })
        await copyFile(artifact.storagePath, path.join(packageRoot, relativePath))
        included.push(relativePath)
      } catch {
        skipped.push({ path: relativePath, reason: "artifact file copy failed" })
      }
    }
  }

  private async writeTextFile(targetPath: string, content: string): Promise<void> {
    await mkdir(path.dirname(targetPath), { recursive: true })
    if (this.deps.writeTextFile) {
      await this.deps.writeTextFile(targetPath, content)
      return
    }
    await writeFile(targetPath, content, "utf8")
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private makeTempDir(prefix: string): Promise<string> {
    return this.deps.makeTempDir?.(prefix) ?? mkdtemp(path.join(os.tmpdir(), prefix))
  }

  private removePath(targetPath: string): Promise<void> {
    return this.deps.removePath?.(targetPath) ?? rm(targetPath, { recursive: true, force: true })
  }

  private async checkWritePermission(outputPath: string, request: AgentConversationExportRequest): Promise<void> {
    if (!this.deps.permissionGuard || !this.deps.auditSink) return
    const permission = await this.deps.permissionGuard.check({
      action: "fs.write",
      actor: { kind: "user", id: "renderer" },
      resource: outputPath,
      context: {
        source: EXPORT_SOURCE,
        projectId: request.projectId,
        conversationId: request.conversationId,
      },
    })
    if (permission.allowed) return
    this.deps.auditSink.record({
      action: "fs.write",
      actor: { kind: "user", id: "renderer" },
      resource: outputPath,
      outcome: "denied",
      metadata: {
        ...auditRequestMetadata(request),
        source: EXPORT_SOURCE,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }

  private recordAudit(
    outcome: "allowed" | "failed",
    outputPath: string,
    metadata: Record<string, unknown>,
  ): void {
    this.deps.auditSink?.record({
      action: "fs.write",
      actor: { kind: "user", id: "renderer" },
      resource: outputPath,
      outcome,
      metadata: {
        source: EXPORT_SOURCE,
        ...metadata,
      },
    })
  }
}

function buildSummary(input: {
  readonly conversation: ConversationEntryV1
  readonly timeline: readonly SynapseAgentTimelineItem[]
  readonly agentEvents: readonly AgentEventEntryV1[]
  readonly agentUsage: readonly AgentUsageEntryV1[]
}) {
  const usageSummary = summarizeUsage(input.conversation, input.agentUsage)
  return sanitizeExportValue({
    conversationId: input.conversation.id,
    projectId: input.conversation.projectId,
    sessionKey: input.conversation.sessionKey,
    agentType: input.conversation.agentType,
    messageCount: input.timeline.filter((entry) => entry.kind === "message").length,
    toolCallCount: input.timeline.filter((entry) => entry.kind === "toolCall").length,
    toolResultCount: input.timeline.filter((entry) => entry.kind === "toolResult").length,
    failedToolCount: input.timeline.filter(isFailedToolResult).length,
    eventCount: input.agentEvents.length,
    usageRowCount: input.agentUsage.length,
    usageSummary,
    costUsd: input.conversation.costUsd,
    costCny: input.conversation.costCny,
    costCurrency: input.conversation.costCurrency,
    createdAt: input.conversation.createdAt,
    updatedAt: input.conversation.updatedAt,
  })
}

function buildAttachmentExportIndex(conversation: ConversationEntryV1): AttachmentExportIndex {
  const messages: AttachmentExportMessage[] = []
  conversation.history.forEach((entry, index) => {
    const attachments = Array.isArray(entry.metadata?.attachments)
      ? entry.metadata.attachments
      : []
    if (attachments.length === 0) return
    messages.push({
      messageIndex: index,
      role: entry.role,
      timestamp: entry.timestamp,
      contentPreview: previewContent(entry.content),
      attachments,
    })
  })
  return {
    schemaVersion: 1,
    binaryIncluded: false,
    messageCount: messages.length,
    attachmentCount: messages.reduce((sum, message) => sum + message.attachments.length, 0),
    messages,
  }
}

function previewContent(content: string): string {
  const normalized = content.trim()
  if (normalized.length <= 200) return normalized
  return `${normalized.slice(0, 200)}...`
}

function isFailedToolResult(entry: SynapseAgentTimelineItem): boolean {
  return entry.kind === "toolResult" && (
    entry.success === false
    || entry.status === "error"
    || entry.status === "failed"
  )
}

function extensionForMimeType(mimeType: AgentArtifactEntryV1["mimeType"]): string {
  switch (mimeType) {
    case "image/png":
      return "png"
    case "image/jpeg":
      return "jpg"
    case "image/gif":
      return "gif"
    case "image/webp":
      return "webp"
    default: {
      const exhaustive: never = mimeType
      return exhaustive
    }
  }
}

function summarizeUsage(
  conversation: ConversationEntryV1,
  rows: readonly AgentUsageEntryV1[],
): UsageSummary {
  const summary: UsageSummary = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  }
  for (const row of rows) {
    summary.inputTokens += finiteNumber(row.usageSummary.inputTokens)
    summary.outputTokens += finiteNumber(row.usageSummary.outputTokens)
    summary.cacheReadInputTokens += finiteNumber(row.usageSummary.cacheReadInputTokens)
    summary.cacheCreationInputTokens += finiteNumber(row.usageSummary.cacheCreationInputTokens)
    summary.reasoningOutputTokens += finiteNumber(row.usageSummary.reasoningOutputTokens)
    summary.totalTokens += finiteNumber(row.usageSummary.totalTokens)
  }
  if (rows.length > 0) return summary
  summary.inputTokens = finiteNumber(conversation.usage?.inputTokens)
  summary.outputTokens = finiteNumber(conversation.usage?.outputTokens)
  summary.cacheReadInputTokens = finiteNumber(conversation.usage?.cacheReadInputTokens)
  summary.cacheCreationInputTokens = finiteNumber(conversation.usage?.cacheCreationInputTokens)
  summary.totalTokens = finiteNumber(conversation.usage?.totalTokens)
  return summary
}

function compareRows<T extends { readonly createdAt?: string; readonly id: string }>(left: T, right: T): number {
  const byCreatedAt = (left.createdAt ?? "").localeCompare(right.createdAt ?? "")
  return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function createDefaultFileName(rawName: string, now: Date): string {
  const safeName = createSafeFileNameSegment(rawName)
  const timestamp = now.toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-")
  return `synapse-agent-conversation-${safeName}-${timestamp}.zip`
}

function createSafeFileNameSegment(rawName: string): string {
  const safeName = rawName
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    || "conversation"
  const chars = Array.from(safeName)
  if (chars.length <= MAX_EXPORT_FILE_NAME_SEGMENT_LENGTH) return safeName
  return chars.slice(0, MAX_EXPORT_FILE_NAME_SEGMENT_LENGTH).join("").trim() || "conversation"
}

function sanitizeExportValue<T>(value: T): unknown {
  return normalizeExportMarkers(redactSensitiveValue(value))
}

function normalizeExportMarkers(value: unknown): unknown {
  if (typeof value === "string") return normalizeExportText(value)
  if (Array.isArray(value)) return value.map((item) => normalizeExportMarkers(item))
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeExportMarkers(item)]))
}

function normalizeExportText(value: string): string {
  return value.replace(/\[key\]/g, "[redacted]")
}

function auditRequestMetadata(request: AgentConversationExportRequest): Record<string, unknown> {
  return {
    projectId: request.projectId,
    conversationId: request.conversationId,
    sessionKey: request.sessionKey ? REDACTED : undefined,
  }
}

function errorAuditMetadata(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

export { AgentConversationExportService }
