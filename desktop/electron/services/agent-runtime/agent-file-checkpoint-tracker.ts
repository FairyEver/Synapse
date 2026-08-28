import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, readFile, realpath } from "node:fs/promises"
import path from "node:path"

import { createTwoFilesPatch, diffLines } from "diff"

import type { StructuredLogger } from "../../runtime/service-registry"
import type {
  AgentFileCheckpointCapture,
  AgentFileCheckpointCapturedFile,
  AgentFileCheckpointFingerprint,
  AgentFileRewindResult,
} from "./types"

const SUPPORTED_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"])
const MAX_SOURCE_BYTES = 512 * 1024
const MAX_FILE_PATCH_BYTES = 128 * 1024
const MAX_CHECKPOINT_PATCH_BYTES = 512 * 1024
const MAX_CHECKPOINT_FILES = 1_000

interface FileSnapshot {
  readonly absolutePath: string
  readonly displayPath: string
  readonly exists: boolean
  readonly fingerprint: AgentFileCheckpointFingerprint
  readonly bytes?: Buffer
  readonly binary: boolean
  readonly truncated: boolean
}

interface ActiveCapture {
  readonly turnId: string
  sdkUserMessageId?: string
  readonly beforeByPath: Map<string, Promise<FileSnapshot>>
  coverageWarning: boolean
}

export class AgentFileCheckpointTracker {
  private readonly cwd: string
  private readonly logger: Pick<StructuredLogger, "warn"> | undefined
  private active: ActiveCapture | undefined

  constructor(input: {
    readonly cwd: string
    readonly logger?: Pick<StructuredLogger, "warn">
  }) {
    this.cwd = path.resolve(input.cwd)
    this.logger = input.logger
  }

  begin(turnId: string): void {
    this.active = {
      turnId,
      beforeByPath: new Map(),
      coverageWarning: false,
    }
  }

  recordSdkUserMessageId(id: string): void {
    if (this.active && !this.active.sdkUserMessageId) {
      this.active.sdkUserMessageId = id
    }
  }

  activeSdkUserMessageId(): string | undefined {
    return this.active?.sdkUserMessageId
  }

  async captureBeforeTool(input: unknown): Promise<void> {
    const active = this.active
    const record = asRecord(input)
    if (!active || !record || record.hook_event_name !== "PreToolUse") return
    if (typeof record.agent_id === "string" || record.tool_name === "Bash") active.coverageWarning = true
    if (typeof record.agent_id === "string") return
    if (typeof record.tool_name !== "string" || !SUPPORTED_WRITE_TOOLS.has(record.tool_name)) return
    const toolInput = asRecord(record.tool_input)
    const requestedPath = stringValue(toolInput?.file_path) ?? stringValue(toolInput?.notebook_path)
    if (!requestedPath) return
    const resolved = this.resolveWorkspacePath(requestedPath)
    if (!resolved || active.beforeByPath.has(resolved.absolutePath)) return
    active.beforeByPath.set(
      resolved.absolutePath,
      snapshotFile(resolved.absolutePath, resolved.displayPath, this.cwd),
    )
    try {
      await active.beforeByPath.get(resolved.absolutePath)
    } catch (error) {
      active.beforeByPath.delete(resolved.absolutePath)
      this.logger?.warn("Agent file checkpoint baseline capture failed.", {
        boundary: "agent-runtime.file-checkpoint.capture",
        errorName: error instanceof Error ? error.name : typeof error,
      })
    }
  }

  async finalize(
    sdkSessionId: string | undefined,
    dryRun: () => Promise<AgentFileRewindResult>,
  ): Promise<AgentFileCheckpointCapture | null> {
    const active = this.active
    this.active = undefined
    if (!active || !active.sdkUserMessageId || !sdkSessionId || active.beforeByPath.size === 0) return null

    let preview: AgentFileRewindResult
    try {
      preview = await dryRun()
    } catch (error) {
      this.logger?.warn("Agent file checkpoint preview failed.", {
        boundary: "agent-runtime.file-checkpoint.preview",
        errorName: error instanceof Error ? error.name : typeof error,
      })
      return null
    }
    if (!preview.canRewind || !preview.filesChanged?.length) return null

    const previewPaths = new Set(
      preview.filesChanged
        .map((value) => this.resolveWorkspacePath(value)?.absolutePath)
        .filter((value): value is string => Boolean(value)),
    )
    if (previewPaths.size !== preview.filesChanged.length) {
      this.logger?.warn("Agent file checkpoint coverage is incomplete; skipping persistence.", {
        boundary: "agent-runtime.file-checkpoint.coverage",
        previewFileCount: preview.filesChanged.length,
        capturedFileCount: active.beforeByPath.size,
      })
      return null
    }
    if (previewPaths.size > MAX_CHECKPOINT_FILES) {
      return {
        turnId: active.turnId,
        sdkSessionId,
        sdkUserMessageId: active.sdkUserMessageId,
        status: "unavailable",
        insertions: preview.insertions ?? 0,
        deletions: preview.deletions ?? 0,
        files: [],
        fileCount: previewPaths.size,
        coverageWarning: active.coverageWarning,
      }
    }
    if ([...previewPaths].some((filePath) => !active.beforeByPath.has(filePath))) {
      this.logger?.warn("Agent file checkpoint coverage is incomplete; skipping persistence.", {
        boundary: "agent-runtime.file-checkpoint.coverage",
        previewFileCount: preview.filesChanged.length,
        capturedFileCount: active.beforeByPath.size,
      })
      return null
    }
    let remainingPayloadBytes = MAX_CHECKPOINT_PATCH_BYTES
    const files: AgentFileCheckpointCapturedFile[] = []
    for (const [absolutePath, beforePromise] of active.beforeByPath) {
      if (!previewPaths.has(absolutePath)) continue
      const before = await beforePromise
      const after = await snapshotFile(absolutePath, before.displayPath, this.cwd)
      if (fingerprintsEqual(before.fingerprint, after.fingerprint)) continue
      const file = buildCapturedFile(before, after, remainingPayloadBytes)
      if (file.patch) remainingPayloadBytes -= Buffer.byteLength(file.patch, "utf8")
      files.push(file)
    }
    if (files.length === 0 || files.length !== previewPaths.size) return null

    return {
      turnId: active.turnId,
      sdkSessionId,
      sdkUserMessageId: active.sdkUserMessageId,
      status: "available",
      // SDK dry-run statistics describe the rewind operation, so additions made by
      // the Agent are reported there as rewind deletions. The checkpoint card must
      // summarize the forward before/after diff that its file rows display.
      insertions: files.reduce((sum, file) => sum + file.insertions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      files,
      fileCount: files.length,
      coverageWarning: active.coverageWarning,
    }
  }

  private resolveWorkspacePath(value: string): { absolutePath: string; displayPath: string } | null {
    const absolutePath = path.resolve(this.cwd, value)
    const displayPath = path.relative(this.cwd, absolutePath)
    if (!displayPath || displayPath === ".." || displayPath.startsWith(`..${path.sep}`) || path.isAbsolute(displayPath)) {
      return null
    }
    return { absolutePath, displayPath }
  }
}

async function snapshotFile(
  absolutePath: string,
  displayPath: string,
  workspacePath: string,
): Promise<FileSnapshot> {
  const parentRealPath = await assertSafeParent(absolutePath, workspacePath)
  try {
    const stats = await lstat(absolutePath)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return missingSnapshot(absolutePath, displayPath, parentRealPath)
    }
    if (stats.nlink !== 1) throw new Error("Agent file checkpoint does not support hard links")
    const fingerprint: AgentFileCheckpointFingerprint = {
      kind: "regular",
      sha256: await hashFile(absolutePath),
      byteSize: stats.size,
      mode: stats.mode,
      device: stats.dev,
      inode: stats.ino,
      parentRealPath,
    }
    if (stats.size > MAX_SOURCE_BYTES) {
      return { absolutePath, displayPath, exists: true, fingerprint, binary: false, truncated: true }
    }
    const bytes = await readFile(absolutePath)
    return {
      absolutePath,
      displayPath,
      exists: true,
      fingerprint,
      bytes,
      binary: bytes.includes(0),
      truncated: false,
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return missingSnapshot(absolutePath, displayPath, parentRealPath)
    }
    throw error
  }
}

async function assertSafeParent(absolutePath: string, workspacePath: string): Promise<string> {
  const [workspaceRealPath, parentRealPath] = await Promise.all([
    realpath(workspacePath),
    realpath(path.dirname(absolutePath)),
  ])
  const relative = path.relative(workspaceRealPath, parentRealPath)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Agent file checkpoint path escapes the workspace")
  }
  return parentRealPath
}

function missingSnapshot(absolutePath: string, displayPath: string, parentRealPath: string): FileSnapshot {
  return {
    absolutePath,
    displayPath,
    exists: false,
    fingerprint: {
      kind: "missing",
      sha256: null,
      byteSize: 0,
      mode: null,
      device: null,
      inode: null,
      parentRealPath,
    },
    binary: false,
    truncated: false,
  }
}

function fingerprintsEqual(
  left: AgentFileCheckpointFingerprint,
  right: AgentFileCheckpointFingerprint,
): boolean {
  return left.kind === right.kind
    && left.sha256 === right.sha256
    && left.byteSize === right.byteSize
    && left.mode === right.mode
    && left.device === right.device
    && left.inode === right.inode
    && left.parentRealPath === right.parentRealPath
}

function buildCapturedFile(
  before: FileSnapshot,
  after: FileSnapshot,
  remainingPayloadBytes: number,
): AgentFileCheckpointCapturedFile {
  const binary = before.binary || after.binary
  const sourceTruncated = before.truncated || after.truncated
  let patch: string | undefined
  let insertions = 0
  let deletions = 0
  if (!binary && !sourceTruncated) {
    const oldText = before.bytes?.toString("utf8") ?? ""
    const newText = after.bytes?.toString("utf8") ?? ""
    for (const change of diffLines(oldText, newText)) {
      if (change.added) insertions += lineCount(change.value)
      if (change.removed) deletions += lineCount(change.value)
    }
    const generated = createTwoFilesPatch(
      before.exists ? `a/${before.displayPath}` : "/dev/null",
      after.exists ? `b/${after.displayPath}` : "/dev/null",
      oldText,
      newText,
      undefined,
      undefined,
      { context: 3 },
    )
    const patchBytes = Buffer.byteLength(generated, "utf8")
    if (patchBytes <= MAX_FILE_PATCH_BYTES && patchBytes <= remainingPayloadBytes) patch = generated
  }
  return {
    displayPath: before.displayPath,
    absolutePath: before.absolutePath,
    kind: !before.exists ? "added" : !after.exists ? "deleted" : "modified",
    insertions,
    deletions,
    beforeExists: before.exists,
    afterExists: after.exists,
    beforeFingerprint: before.fingerprint,
    afterFingerprint: after.fingerprint,
    binary,
    truncated: sourceTruncated || (!binary && patch === undefined),
    ...(patch ? { patch } : {}),
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest("hex")
}

function lineCount(value: string): number {
  if (!value) return 0
  const matches = value.match(/\n/g)?.length ?? 0
  return value.endsWith("\n") ? matches : matches + 1
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { code?: unknown }).code === "ENOENT" || (error as { code?: unknown }).code === "ENOTDIR")
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

export function agentFileCheckpointFileId(): string {
  return randomUUID()
}

export function isReplayedUserMessage(value: Record<string, unknown>): boolean {
  if (value.type !== "user" || value.parent_tool_use_id !== null || typeof value.uuid !== "string") return false
  const message = asRecord(value.message)
  if (message?.role !== "user") return false
  const content = message.content
  return !Array.isArray(content) || !content.some((block) => asRecord(block)?.type === "tool_result")
}
