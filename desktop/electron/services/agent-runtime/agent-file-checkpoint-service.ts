import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, realpath } from "node:fs/promises"
import path from "node:path"

import type {
  AgentFileCheckpointEntryV1,
  AgentFileCheckpointFileV1,
  AgentFileCheckpointFingerprintV1,
  DataNamespace,
} from "../../runtime/data-repo"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../../runtime/security"
import { agentFileCheckpointFileId } from "./agent-file-checkpoint-tracker"
import type {
  AgentEvent,
  AgentFileCheckpointCapture,
  AgentFileRewindResult,
} from "./types"

const OPERATION_TTL_MS = 5 * 60 * 1000
const DEFAULT_MAX_STORED_PATCH_BYTES = 64 * 1024 * 1024

export interface AgentFileCheckpointDetail {
  readonly id: string
  readonly conversationId: string
  readonly status: AgentFileCheckpointEntryV1["status"]
  readonly insertions: number
  readonly deletions: number
  readonly fileCount: number
  readonly files: readonly {
    readonly id: string
    readonly path: string
    readonly kind: AgentFileCheckpointFileV1["kind"]
    readonly insertions: number
    readonly deletions: number
    readonly binary: boolean
    readonly truncated: boolean
  }[]
}

export interface AgentFileCheckpointDiff {
  readonly checkpointId: string
  readonly fileId: string
  readonly path: string
  readonly kind: AgentFileCheckpointFileV1["kind"]
  readonly patch?: string
  readonly binary: boolean
  readonly truncated: boolean
  readonly diffCleared?: boolean
}

export interface AgentFileCheckpointPrepareResult {
  readonly operationId: string
  readonly expiresAt: string
  readonly filesChanged: readonly string[]
  readonly insertions: number
  readonly deletions: number
  readonly coverageWarning: boolean
}

export interface AgentFileCheckpointRewindResult {
  readonly checkpointId: string
  readonly status: "rewound" | "partial"
  readonly skippedLinks: number
  readonly event: AgentEvent
}

export class AgentFileCheckpointUnavailableError extends Error {
  readonly event: AgentEvent

  constructor(message: string, event: AgentEvent) {
    super(message)
    this.name = "AgentFileCheckpointUnavailableError"
    this.event = event
  }
}

export class AgentFileCheckpointPartialError extends Error {
  readonly event: AgentEvent

  constructor(message: string, event: AgentEvent) {
    super(message)
    this.name = "AgentFileCheckpointPartialError"
    this.event = event
  }
}

interface PreparedOperation {
  readonly id: string
  readonly checkpointId: string
  readonly conversationId: string
  readonly expiresAt: number
  readonly actor: ActorIdentity
}

export class AgentFileCheckpointService {
  private readonly projectId: string
  private readonly workspacePath: string
  private readonly checkpoints: DataNamespace<AgentFileCheckpointEntryV1>
  private readonly permissionGuard: PermissionGuard
  private readonly auditSink: AuditSink
  private readonly now: () => Date
  private readonly maxStoredPatchBytes: number
  private readonly operations = new Map<string, PreparedOperation>()

  constructor(input: {
    readonly projectId: string
    readonly workspacePath: string
    readonly checkpoints: DataNamespace<AgentFileCheckpointEntryV1>
    readonly permissionGuard: PermissionGuard
    readonly auditSink: AuditSink
    readonly now?: () => Date
    readonly maxStoredPatchBytes?: number
  }) {
    this.projectId = input.projectId
    this.workspacePath = path.resolve(input.workspacePath)
    this.checkpoints = input.checkpoints
    this.permissionGuard = input.permissionGuard
    this.auditSink = input.auditSink
    this.now = input.now ?? (() => new Date())
    this.maxStoredPatchBytes = input.maxStoredPatchBytes ?? DEFAULT_MAX_STORED_PATCH_BYTES
  }

  async persistCapture(conversationId: string, capture: AgentFileCheckpointCapture): Promise<readonly AgentEvent[]> {
    const timestamp = this.now().toISOString()
    const statusEvents = await this.supersedeAvailable(conversationId, timestamp)
    const entry: AgentFileCheckpointEntryV1 = {
      id: randomUUID(),
      schemaVersion: 1,
      projectId: this.projectId,
      conversationId,
      turnId: capture.turnId,
      sdkSessionId: capture.sdkSessionId,
      sdkUserMessageId: capture.sdkUserMessageId,
      status: capture.status,
      insertions: capture.insertions,
      deletions: capture.deletions,
      files: capture.files.map((file) => ({ ...file, id: agentFileCheckpointFileId() })),
      fileCount: capture.fileCount,
      coverageWarning: capture.coverageWarning,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await this.checkpoints.upsert(entry)
    await this.cleanupStoredPatches()
    return [...statusEvents, checkpointEvent(entry, timestamp)]
  }

  async supersedeAvailable(
    conversationId: string,
    timestamp = this.now().toISOString(),
  ): Promise<readonly AgentEvent[]> {
    const events: AgentEvent[] = []
    for (const existing of await this.checkpoints.list({ conversationId })) {
      if (existing.status !== "available") continue
      const superseded = { ...existing, status: "superseded", updatedAt: timestamp } as AgentFileCheckpointEntryV1
      await this.checkpoints.upsert(superseded)
      events.push(checkpointEvent(superseded, timestamp))
    }
    return events
  }

  async detail(conversationId: string, checkpointId: string): Promise<AgentFileCheckpointDetail> {
    const entry = await this.requireOwnedCheckpoint(conversationId, checkpointId)
    return {
      id: entry.id,
      conversationId: entry.conversationId,
      status: entry.status,
      insertions: entry.insertions,
      deletions: entry.deletions,
      fileCount: entry.fileCount,
      files: entry.files.map((file) => ({
        id: file.id,
        path: file.displayPath,
        kind: file.kind,
        insertions: file.insertions,
        deletions: file.deletions,
        binary: file.binary,
        truncated: file.truncated,
      })),
    }
  }

  async diff(conversationId: string, checkpointId: string, fileId: string): Promise<AgentFileCheckpointDiff> {
    const entry = await this.requireOwnedCheckpoint(conversationId, checkpointId)
    const file = entry.files.find((candidate) => candidate.id === fileId)
    if (!file) throw new Error("未找到该检查点文件。")
    await this.checkpoints.upsert({ ...entry, lastAccessedAt: this.now().toISOString() })
    return {
      checkpointId,
      fileId,
      path: file.displayPath,
      kind: file.kind,
      patch: file.patch,
      binary: file.binary,
      truncated: file.truncated,
      diffCleared: file.diffCleared,
    }
  }

  async prepareRewind(input: {
    readonly conversationId: string
    readonly checkpointId: string
    readonly actor: ActorIdentity
    readonly busy: boolean
    readonly rewind: (
      sdkUserMessageId: string,
      dryRun: boolean,
      sdkSessionId: string,
    ) => Promise<AgentFileRewindResult>
  }): Promise<AgentFileCheckpointPrepareResult> {
    const entry = await this.requireLatestAvailable(input.conversationId, input.checkpointId, input.busy)
    this.removeExpiredOperations()
    await this.assertPermission(entry, input.actor)
    await this.assertAfterFingerprints(entry)
    const preview = await input.rewind(entry.sdkUserMessageId, true, entry.sdkSessionId)
    if (!preview.canRewind) await this.markUnavailable(entry, preview.error)
    this.assertPreviewMatches(entry, preview)
    const operationId = randomUUID()
    const expiresAt = this.now().getTime() + OPERATION_TTL_MS
    for (const [id, operation] of this.operations) {
      if (operation.checkpointId === entry.id) this.operations.delete(id)
    }
    this.operations.set(operationId, {
      id: operationId,
      checkpointId: entry.id,
      conversationId: entry.conversationId,
      expiresAt,
      actor: input.actor,
    })
    return {
      operationId,
      expiresAt: new Date(expiresAt).toISOString(),
      filesChanged: entry.files.map((file) => file.displayPath),
      insertions: preview.insertions ?? entry.insertions,
      deletions: preview.deletions ?? entry.deletions,
      coverageWarning: entry.coverageWarning,
    }
  }

  async confirmRewind(input: {
    readonly conversationId: string
    readonly operationId: string
    readonly busy: boolean
    readonly rewind: (
      sdkUserMessageId: string,
      dryRun: boolean,
      sdkSessionId: string,
    ) => Promise<AgentFileRewindResult>
  }): Promise<AgentFileCheckpointRewindResult> {
    const operation = this.operations.get(input.operationId)
    this.operations.delete(input.operationId)
    if (!operation || operation.expiresAt < this.now().getTime()) throw new Error("撤销确认已过期，请重新预览。")
    if (operation.conversationId !== input.conversationId) throw new Error("撤销确认不属于当前会话。")
    const entry = await this.requireLatestAvailable(operation.conversationId, operation.checkpointId, input.busy)
    await this.assertPermission(entry, operation.actor)
    await this.assertAfterFingerprints(entry)
    const preview = await input.rewind(entry.sdkUserMessageId, true, entry.sdkSessionId)
    if (!preview.canRewind) await this.markUnavailable(entry, preview.error)
    this.assertPreviewMatches(entry, preview)

    let result: AgentFileRewindResult
    try {
      result = await input.rewind(entry.sdkUserMessageId, false, entry.sdkSessionId)
    } catch (error) {
      throw await this.markPartialAfterFailure(entry, operation.actor, error)
    }
    const restored = await this.beforeFingerprintMatches(entry)
    const status = result.canRewind && restored.every(Boolean) && (result.skippedLinks ?? 0) === 0
      ? "rewound"
      : "partial"
    const updated = { ...entry, status, updatedAt: this.now().toISOString() } as AgentFileCheckpointEntryV1
    await this.checkpoints.upsert(updated)
    await this.cleanupStoredPatches()
    this.auditFinalOutcomes(entry, operation.actor, restored, {
      status,
      skippedLinks: result.skippedLinks ?? 0,
    })
    return {
      checkpointId: entry.id,
      status,
      skippedLinks: result.skippedLinks ?? 0,
      event: checkpointEvent(updated, updated.updatedAt),
    }
  }

  async removeConversation(conversationId: string): Promise<void> {
    for (const entry of await this.checkpoints.list({ conversationId })) {
      await this.checkpoints.remove(entry.id)
    }
    for (const [id, operation] of this.operations) {
      if (operation.conversationId === conversationId) this.operations.delete(id)
    }
  }

  private async requireOwnedCheckpoint(conversationId: string, checkpointId: string): Promise<AgentFileCheckpointEntryV1> {
    const entry = await this.checkpoints.get(checkpointId)
    if (!entry || entry.projectId !== this.projectId || entry.conversationId !== conversationId) {
      throw new Error("未找到该文件检查点。")
    }
    return entry
  }

  private async requireLatestAvailable(
    conversationId: string,
    checkpointId: string,
    busy: boolean,
  ): Promise<AgentFileCheckpointEntryV1> {
    if (busy) throw new Error("Agent 正在运行，暂时不能撤销文件修改。")
    const entry = await this.requireOwnedCheckpoint(conversationId, checkpointId)
    const latest = (await this.checkpoints.list({ conversationId }))
      .filter((candidate) => candidate.status === "available")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    if (entry.status !== "available" || latest?.id !== entry.id) {
      throw new Error("只能撤销当前会话最新一轮的文件修改。")
    }
    return entry
  }

  private async assertPermission(entry: AgentFileCheckpointEntryV1, actor: ActorIdentity): Promise<void> {
    for (const file of entry.files) {
      const result = await this.permissionGuard.check({
        action: "fs.write",
        actor,
        resource: file.absolutePath,
        context: checkpointAuditMetadata(entry, { fileId: file.id, path: file.displayPath }),
      })
      if (!result.allowed) {
        this.auditSink.record({
          action: "fs.write",
          actor,
          resource: file.absolutePath,
          outcome: "denied",
          metadata: checkpointAuditMetadata(entry, { reason: result.reason, policyId: result.policyId }),
        })
        throw new Error("没有撤销这些文件修改的权限。")
      }
      this.auditSink.record({
        action: "fs.write",
        actor,
        resource: file.absolutePath,
        outcome: "allowed",
        metadata: checkpointAuditMetadata(entry, {
          fileId: file.id,
          path: file.displayPath,
          phase: "permission-check",
        }),
      })
    }
  }

  private async assertAfterFingerprints(entry: AgentFileCheckpointEntryV1): Promise<void> {
    for (const file of entry.files) {
      if (!fingerprintsEqual(
        await fingerprintRegularPath(file.absolutePath, this.workspacePath),
        file.afterFingerprint,
      )) {
        throw new Error(`文件已在检查点后发生变化：${file.displayPath}`)
      }
    }
  }

  private async beforeFingerprintMatches(entry: AgentFileCheckpointEntryV1): Promise<boolean[]> {
    return Promise.all(entry.files.map(async (file) => {
      try {
        return fingerprintsEqual(
          await fingerprintRegularPath(file.absolutePath, this.workspacePath),
          file.beforeFingerprint,
        )
      } catch {
        return false
      }
    }))
  }

  private assertPreviewMatches(entry: AgentFileCheckpointEntryV1, preview: AgentFileRewindResult): void {
    const expected = entry.files.map((file) => file.absolutePath).sort()
    const actual = (preview.filesChanged ?? [])
      .map((value) => path.resolve(this.workspacePath, value))
      .sort()
    if (expected.length !== actual.length || expected.some((value, index) => value !== actual[index])) {
      throw new Error("文件集合已变化，请重新运行 Agent 后再试。")
    }
  }

  private async markUnavailable(entry: AgentFileCheckpointEntryV1, reason?: string): Promise<never> {
    const timestamp = this.now().toISOString()
    const updated = { ...entry, status: "unavailable", updatedAt: timestamp } as AgentFileCheckpointEntryV1
    await this.checkpoints.upsert(updated)
    throw new AgentFileCheckpointUnavailableError(
      reason || "当前检查点的 SDK 文件历史已不可用。",
      checkpointEvent(updated, timestamp),
    )
  }

  private async markPartialAfterFailure(
    entry: AgentFileCheckpointEntryV1,
    actor: ActorIdentity,
    error: unknown,
  ): Promise<AgentFileCheckpointPartialError> {
    const timestamp = this.now().toISOString()
    const restored = await this.beforeFingerprintMatches(entry)
    const updated = { ...entry, status: "partial", updatedAt: timestamp } as AgentFileCheckpointEntryV1
    await this.checkpoints.upsert(updated)
    await this.cleanupStoredPatches()
    this.auditFinalOutcomes(entry, actor, restored, {
      status: "partial",
      errorName: error instanceof Error ? error.name : typeof error,
    })
    return new AgentFileCheckpointPartialError(
      "撤销未完整完成，请审查文件差异。",
      checkpointEvent(updated, timestamp),
    )
  }

  private auditFinalOutcomes(
    entry: AgentFileCheckpointEntryV1,
    actor: ActorIdentity,
    restored: readonly boolean[],
    metadata: Record<string, unknown>,
  ): void {
    entry.files.forEach((file, index) => {
      this.auditSink.record({
        action: "fs.write",
        actor,
        resource: file.absolutePath,
        outcome: restored[index] ? "allowed" : "failed",
        metadata: checkpointAuditMetadata(entry, {
          fileId: file.id,
          path: file.displayPath,
          phase: "rewind-result",
          ...metadata,
        }),
      })
    })
  }

  private async cleanupStoredPatches(): Promise<void> {
    const entries = await this.checkpoints.list()
    let totalBytes = entries.reduce((sum, entry) => sum + checkpointPatchBytes(entry), 0)
    if (totalBytes <= this.maxStoredPatchBytes) return
    const eligible = entries
      .filter((entry) => entry.status === "superseded" || entry.status === "rewound")
      .sort((left, right) => (
        (left.lastAccessedAt ?? left.updatedAt).localeCompare(right.lastAccessedAt ?? right.updatedAt)
      ))
    for (const entry of eligible) {
      if (totalBytes <= this.maxStoredPatchBytes) break
      const removedBytes = checkpointPatchBytes(entry)
      if (removedBytes === 0) continue
      const files = entry.files.map((file) => {
        if (!file.patch) return file
        const { patch: _patch, ...rest } = file
        return { ...rest, truncated: true, diffCleared: true }
      })
      await this.checkpoints.upsert({ ...entry, files, updatedAt: this.now().toISOString() })
      totalBytes -= removedBytes
    }
  }

  private removeExpiredOperations(): void {
    const now = this.now().getTime()
    for (const [id, operation] of this.operations) {
      if (operation.expiresAt < now) this.operations.delete(id)
    }
  }
}

function checkpointEvent(entry: AgentFileCheckpointEntryV1, timestamp: string): AgentEvent {
  return {
    type: "fileCheckpoint",
    checkpointId: entry.id,
    status: entry.status,
    insertions: entry.insertions,
    deletions: entry.deletions,
    files: entry.files.map((file) => ({
      id: file.id,
      path: file.displayPath,
      kind: file.kind,
      insertions: file.insertions,
      deletions: file.deletions,
      binary: file.binary,
      truncated: file.truncated,
    })),
    fileCount: entry.fileCount,
    coverageWarning: entry.coverageWarning,
    conversationId: entry.conversationId,
    turnId: entry.turnId,
    sdkSessionId: entry.sdkSessionId,
    timestamp,
  }
}

async function fingerprintRegularPath(
  filePath: string,
  workspacePath: string,
): Promise<AgentFileCheckpointFingerprintV1> {
  const parentRealPath = await assertSafeWorkspacePath(filePath, workspacePath)
  try {
    const stats = await lstat(filePath)
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("检查点路径不再是普通文件。")
    if (stats.nlink !== 1) throw new Error("检查点路径不再是独立普通文件。")
    const hash = createHash("sha256")
    for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer)
    return {
      kind: "regular",
      sha256: hash.digest("hex"),
      byteSize: stats.size,
      mode: stats.mode,
      device: stats.dev,
      inode: stats.ino,
      parentRealPath,
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        kind: "missing",
        sha256: null,
        byteSize: 0,
        mode: null,
        device: null,
        inode: null,
        parentRealPath,
      }
    }
    throw error
  }
}

async function assertSafeWorkspacePath(filePath: string, workspacePath: string): Promise<string> {
  const relative = path.relative(workspacePath, filePath)
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("检查点文件已超出当前工作区。")
  }
  const [workspaceRealPath, parentRealPath] = await Promise.all([
    realpath(workspacePath),
    realpath(path.dirname(filePath)),
  ])
  const parentRelative = path.relative(workspaceRealPath, parentRealPath)
  if (parentRelative === ".." || parentRelative.startsWith(`..${path.sep}`) || path.isAbsolute(parentRelative)) {
    throw new Error("检查点文件父目录已离开当前工作区。")
  }
  return parentRealPath
}

function fingerprintsEqual(
  left: AgentFileCheckpointFingerprintV1,
  right: AgentFileCheckpointFingerprintV1,
): boolean {
  return left.kind === right.kind
    && left.sha256 === right.sha256
    && left.byteSize === right.byteSize
    && left.mode === right.mode
    && left.device === right.device
    && left.inode === right.inode
    && left.parentRealPath === right.parentRealPath
}

function checkpointPatchBytes(entry: AgentFileCheckpointEntryV1): number {
  return entry.files.reduce((sum, file) => sum + (file.patch ? Buffer.byteLength(file.patch, "utf8") : 0), 0)
}

function checkpointAuditMetadata(
  entry: AgentFileCheckpointEntryV1,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    source: "agent.file-checkpoint.rewind",
    projectId: entry.projectId,
    conversationId: entry.conversationId,
    checkpointId: entry.id,
    fileCount: entry.files.length,
    ...extra,
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { code?: unknown }).code === "ENOENT" || (error as { code?: unknown }).code === "ENOTDIR")
}
