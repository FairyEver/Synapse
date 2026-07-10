import { createHash, randomUUID } from "node:crypto"
import { access, constants, lstat, open, readdir, realpath } from "node:fs/promises"
import type { FileHandle } from "node:fs/promises"
import path from "node:path"

import type { ActorIdentity, AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import type { TrustedSkillRoot } from "../../../electron/services/editor-scan-roots"
import { parseDotenvDocument, patchDotenvValues } from "../../../electron/services/skill-env/dotenv-document"
import type {
  SecretSkillEnvQueueInput,
  SecretSkillEnvQueueResult,
  SecretSkillEnvScanResult,
  SkillEnvBindingQueueItem,
  SkillEnvBindingItem,
} from "../shared/schema"

const SCAN_SESSION_TTL_MS = 300_000

export type SkillEnvBindingLogger = {
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}

export type SkillEnvBindingSecurity = {
  readonly actor: ActorIdentity
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
}

export type SkillEnvBindingServiceDeps = {
  readonly listRoots: () => Promise<TrustedSkillRoot[]>
  readonly createId?: () => string
  readonly now?: () => number
  readonly logger: SkillEnvBindingLogger
  readonly openFile?: (filePath: string, flags: number) => Promise<FileHandle>
}

type StoredBinding = {
  readonly publicItem: SkillEnvBindingItem
  readonly root: TrustedSkillRoot
  readonly fileHash: string | null
  readonly rootIdentity: FileIdentity | null
  readonly skillIdentity: FileIdentity | null
  readonly envIdentity: FileIdentity | null
  readonly rootRealPath: string | null
  readonly skillRealPath: string | null
  readonly envRealPath: string | null
}

type FileIdentity = {
  readonly dev: number
  readonly ino: number
  readonly size: number
  readonly mtimeMs: number
  readonly ctimeMs: number
  readonly birthtimeMs: number
}

function emptyBindingEvidence(): Pick<StoredBinding, "rootIdentity" | "skillIdentity" | "envIdentity" | "rootRealPath" | "skillRealPath" | "envRealPath"> {
  return {
    rootIdentity: null,
    skillIdentity: null,
    envIdentity: null,
    rootRealPath: null,
    skillRealPath: null,
    envRealPath: null,
  }
}

type ScanSession = {
  readonly createdAt: number
  readonly name: string
  readonly items: ReadonlyMap<string, StoredBinding>
}

type ValidatedBinding = {
  readonly handle: FileHandle
  readonly content: string
  readonly envPath: string
  readonly mode: number
  readonly rootIdentity: FileIdentity
  readonly skillIdentity: FileIdentity
  readonly envIdentity: FileIdentity
  readonly rootRealPath: string
  readonly skillRealPath: string
  readonly envRealPath: string
}

class UnsafeBindingError extends Error {
  readonly code = "unsafe_link"
}

class StaleBindingError extends Error {
  readonly code = "conflict"
}

class BindingIoError extends Error {
  readonly code = "failed"
  readonly causeCode?: string

  constructor(message: string, causeCode?: string) {
    super(message)
    this.causeCode = causeCode
  }
}

export function createSkillEnvBindingService(deps: SkillEnvBindingServiceDeps) {
  const sessions = new Map<string, ScanSession>()
  let queueTail: Promise<void> = Promise.resolve()
  const now = () => deps.now?.() ?? Date.now()
  const createId = () => deps.createId?.() ?? randomUUID()

  function pruneSessions(timestamp: number): void {
    for (const [id, session] of sessions) {
      if (timestamp - session.createdAt >= SCAN_SESSION_TTL_MS) sessions.delete(id)
    }
  }

  async function scan(
    name: string,
    value: string,
    security: SkillEnvBindingSecurity,
  ): Promise<SecretSkillEnvScanResult> {
    const timestamp = now()
    pruneSessions(timestamp)
    const storedItems = new Map<string, StoredBinding>()

    for (const root of await deps.listRoots()) {
      if (!(await allowRootRead(root, security, "skill-env-binding-scan"))) continue
      const rootItems = await scanRoot(root, name, value)
      for (const item of rootItems) storedItems.set(item.publicItem.id, item)
    }

    const scanSessionId = createId()
    sessions.set(scanSessionId, { createdAt: timestamp, name, items: storedItems })
    return {
      scanSessionId,
      items: Array.from(storedItems.values())
        .map(({ publicItem }) => publicItem)
        .sort((left, right) => left.skillName.localeCompare(right.skillName)
          || left.envPath.localeCompare(right.envPath)),
    }
  }

  async function enqueue(
    input: SecretSkillEnvQueueInput,
    value: string,
    security: SkillEnvBindingSecurity,
  ): Promise<SecretSkillEnvQueueResult> {
    const run = queueTail.then(async () => {
      const timestamp = now()
      pruneSessions(timestamp)
      const session = sessions.get(input.scanSessionId)
      if (!session) throw new Error("扫描会话已过期，请重新扫描。")
      if (session.name !== input.name) throw new Error("扫描会话的密钥名称不匹配。")
      if (new Set(input.itemIds).size !== input.itemIds.length) {
        throw new Error("扫描项目无效，请重新扫描。")
      }
      const selected = input.itemIds.map((id) => session.items.get(id))
      if (selected.some((item) => !item)) throw new Error("扫描项目无效，请重新扫描。")

      const currentRoots = await deps.listRoots()
      const results: SkillEnvBindingQueueItem[] = []
      for (const stored of selected as StoredBinding[]) {
        results.push(await updateOne(stored, input.name, value, currentRoots, security))
      }
      return { items: results }
    })
    queueTail = run.then(() => undefined, () => undefined)
    return run
  }

  async function scanRoot(
    root: TrustedSkillRoot,
    name: string,
    value: string,
  ): Promise<StoredBinding[]> {
    let entries
    let rootIdentity: FileIdentity
    try {
      const rootInfo = await lstat(root.path)
      if (!rootInfo.isDirectory()) return []
      rootIdentity = toFileIdentity(rootInfo)
      entries = await readdir(root.path, { withFileTypes: true })
      const rootAfter = await lstat(root.path)
      if (rootAfter.isSymbolicLink() || !sameIdentity(rootIdentity, toFileIdentity(rootAfter))) return []
    } catch {
      deps.logger.warn("Failed to scan trusted Skill root.", { scope: root.scope })
      return []
    }

    const items: StoredBinding[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      try {
        const rootBeforeCandidate = await lstat(root.path)
        if (rootBeforeCandidate.isSymbolicLink()
          || !sameIdentity(rootIdentity, toFileIdentity(rootBeforeCandidate))) return []
      } catch {
        return []
      }
      const skillName = entry.name
      const skillPath = path.join(root.path, skillName)
      const envPath = path.join(skillPath, ".env")
      const skillMdPath = path.join(skillPath, "SKILL.md")
      let skillInfo
      let envInfo
      try {
        ;[skillInfo, envInfo] = await Promise.all([lstat(skillMdPath), lstat(envPath)])
      } catch (error) {
        if (isNotFoundLikeError(error)) continue
        const base = createPublicItem(createId(), root, skillName, envPath)
        items.push({
          publicItem: { ...base, status: "unwritable", message: "配置文件读取失败。" },
          root,
          fileHash: null,
          ...emptyBindingEvidence(),
        })
        continue
      }
      if (!skillInfo.isFile() || skillInfo.isSymbolicLink()) continue

      const base = createPublicItem(createId(), root, skillName, envPath)
      if (envInfo.isSymbolicLink()) {
        items.push({
          publicItem: { ...base, status: "unsafe_link", message: "配置文件是符号链接。" },
          root,
          fileHash: null,
          ...emptyBindingEvidence(),
        })
        continue
      }
      if (!envInfo.isFile()) continue

      let validated: ValidatedBinding | undefined
      try {
        validated = await openValidatedBinding(root, skillName, envPath, "read", deps.openFile)
      } catch (error) {
        if (error instanceof UnsafeBindingError) {
          items.push({
            publicItem: { ...base, status: "unsafe_link", message: "配置文件路径不安全。" },
            root,
            fileHash: null,
            ...emptyBindingEvidence(),
          })
          continue
        }
        items.push({
          publicItem: { ...base, status: "unwritable", message: "配置文件不可读或不可写。" },
          root,
          fileHash: null,
          ...emptyBindingEvidence(),
        })
        continue
      }
      let content: string
      try {
        content = validated.content
      } finally {
        await validated.handle.close().catch(() => undefined)
      }
      const fileHash = hashContent(content)
      try {
        const document = parseDotenvDocument(content)
        const match = document.entries.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())
        if (!match) continue
        if (match.value === value) {
          items.push({
            publicItem: { ...base, status: "up_to_date" },
            root,
            fileHash,
            rootIdentity: validated.rootIdentity,
            skillIdentity: validated.skillIdentity,
            envIdentity: validated.envIdentity,
            rootRealPath: validated.rootRealPath,
            skillRealPath: validated.skillRealPath,
            envRealPath: validated.envRealPath,
          })
          continue
        }
        const writable = (envInfo.mode & 0o222) !== 0 && await isWritable(envPath)
        items.push({
          publicItem: writable
            ? { ...base, status: "needs_update" }
            : { ...base, status: "unwritable", message: "配置文件不可写。" },
          root,
          fileHash,
          rootIdentity: validated.rootIdentity,
          skillIdentity: validated.skillIdentity,
          envIdentity: validated.envIdentity,
          rootRealPath: validated.rootRealPath,
          skillRealPath: validated.skillRealPath,
          envRealPath: validated.envRealPath,
        })
      } catch {
        items.push({
          publicItem: { ...base, status: "invalid", message: "配置文件格式无效。" },
          root,
          fileHash,
          rootIdentity: validated.rootIdentity,
          skillIdentity: validated.skillIdentity,
          envIdentity: validated.envIdentity,
          rootRealPath: validated.rootRealPath,
          skillRealPath: validated.skillRealPath,
          envRealPath: validated.envRealPath,
        })
      }
    }
    return items
  }

  async function updateOne(
    stored: StoredBinding,
    name: string,
    value: string,
    currentRoots: readonly TrustedSkillRoot[],
    security: SkillEnvBindingSecurity,
  ): Promise<SkillEnvBindingQueueItem> {
    const base = queueItemBase(stored.publicItem)
    const auditMetadata = {
      operation: "skill-env-binding-queue",
      secretName: name,
      editorIds: stored.publicItem.editors.map(({ id }) => id),
      scope: stored.publicItem.scope,
      skillName: stored.publicItem.skillName,
    }

    try {
      if (!(await allowRootRead(stored.root, security, "skill-env-binding-queue-revalidate"))) {
        return recordQueueResult(base, "failed", "没有读取该位置的权限。", security, auditMetadata, "denied")
      }
      if (!stored.fileHash
        || !stored.rootIdentity
        || !stored.skillIdentity
        || !stored.envIdentity
        || !(await rootStillTrusted(stored.root, currentRoots))
        || !(await bindingStillMatches(stored))) {
        return recordQueueResult(base, "conflict", "扫描结果已失效。", security, auditMetadata)
      }
      const validated = await openValidatedBinding(
        stored.root,
        stored.publicItem.skillName,
        stored.publicItem.envPath,
        "write",
        deps.openFile,
      )
      try {
        if (!sameIdentity(stored.rootIdentity, validated.rootIdentity)
          || !sameIdentity(stored.skillIdentity, validated.skillIdentity)
          || !sameIdentity(stored.envIdentity, validated.envIdentity)
          || stored.rootRealPath !== validated.rootRealPath
          || stored.skillRealPath !== validated.skillRealPath
          || stored.envRealPath !== validated.envRealPath) {
          return recordQueueResult(base, "conflict", "扫描结果已失效。", security, auditMetadata)
        }
        if (hashContent(validated.content) !== stored.fileHash) {
          return recordQueueResult(base, "conflict", "配置文件已发生变化。", security, auditMetadata)
        }
        if ((validated.mode & 0o222) === 0) {
          return recordQueueResult(base, "failed", "配置文件不可写。", security, auditMetadata)
        }

        const document = parseDotenvDocument(validated.content)
        const matches = document.entries.filter((entry) => entry.name.toLowerCase() === name.toLowerCase())
        if (matches.length !== 1) {
          return recordQueueResult(base, "conflict", "配置键已发生变化。", security, auditMetadata)
        }
        const nextContent = patchDotenvValues(validated.content, { [matches[0].name]: value })
        const permission = await security.permissionGuard.check({
          action: "fs.write",
          actor: security.actor,
          resource: validated.envPath,
          context: auditMetadata,
        })
        if (!permission.allowed) {
          return recordQueueResult(base, "failed", "没有写入该位置的权限。", security, {
            ...auditMetadata,
            policyId: permission.policyId,
          }, "denied")
        }
        const currentStat = await validated.handle.stat()
        const pathStat = await lstat(stored.publicItem.envPath)
        const currentEnvRealPath = await realpath(stored.publicItem.envPath)
        if (!sameIdentity(currentStat, pathStat) || currentEnvRealPath !== validated.envPath) {
          return recordQueueResult(base, "conflict", "配置文件已发生变化。", security, auditMetadata)
        }
        await validated.handle.truncate(0)
        await writeFileHandleFully(validated.handle, nextContent)
        return recordQueueResult(base, "updated", undefined, security, auditMetadata)
      } finally {
        await validated.handle.close().catch(() => undefined)
      }
    } catch (error) {
      deps.logger.warn("Failed to apply Skill env binding.", {
        scope: stored.publicItem.scope,
        skillName: stored.publicItem.skillName,
      })
      if (error instanceof StaleBindingError) {
        return recordQueueResult(base, "conflict", "配置文件已发生变化。", security, auditMetadata)
      }
      if (error instanceof UnsafeBindingError) {
        return recordQueueResult(base, "failed", "配置文件路径不安全。", security, auditMetadata)
      }
      return recordQueueResult(base, "failed", "配置文件写入失败。", security, auditMetadata, "failed")
    }
  }

  return { scan, enqueue }
}

export type SkillEnvBindingService = ReturnType<typeof createSkillEnvBindingService>

async function allowRootRead(
  root: TrustedSkillRoot,
  security: SkillEnvBindingSecurity,
  operation: "skill-env-binding-scan" | "skill-env-binding-queue-revalidate",
): Promise<boolean> {
  const context = { operation, scope: root.scope }
  const permission = await security.permissionGuard.check({
    action: "fs.read.outside-userdata",
    actor: security.actor,
    resource: root.path,
    context,
  })
  if (permission.allowed) {
    security.auditSink.record({
      action: "fs.read.outside-userdata",
      actor: security.actor,
      resource: root.path,
      outcome: "allowed",
      metadata: context,
    })
    return true
  }
  security.auditSink.record({
    action: "fs.read.outside-userdata",
    actor: security.actor,
    resource: root.path,
    outcome: "denied",
    metadata: { ...context, policyId: permission.policyId },
  })
  return false
}

function createPublicItem(
  id: string,
  root: TrustedSkillRoot,
  skillName: string,
  envPath: string,
): Omit<SkillEnvBindingItem, "status"> {
  return {
    id,
    skillName,
    editors: root.editors.map(({ id: editorId, label }) => ({ id: editorId, label })),
    scope: root.scope,
    ...(root.projectId ? { projectId: root.projectId } : undefined),
    ...(root.projectName ? { projectName: root.projectName } : undefined),
    envPath,
  }
}

function queueItemBase(item: SkillEnvBindingItem): Omit<SkillEnvBindingQueueItem, "status"> {
  const { status: _status, ...base } = item
  return base
}

function recordQueueResult(
  base: Omit<SkillEnvBindingQueueItem, "status">,
  status: SkillEnvBindingQueueItem["status"],
  message: string | undefined,
  security: SkillEnvBindingSecurity,
  metadata: Record<string, unknown>,
  auditOutcome: "allowed" | "denied" | "failed" = status === "updated" ? "allowed" : "failed",
): SkillEnvBindingQueueItem {
  security.auditSink.record({
    action: "fs.write",
    actor: security.actor,
    resource: base.envPath,
    outcome: auditOutcome,
    metadata: { ...metadata, outcome: status },
  })
  return { ...base, status, ...(message ? { message } : undefined) }
}

async function openValidatedBinding(
  root: TrustedSkillRoot,
  skillName: string,
  expectedEnvPath: string,
  mode: "read" | "write",
  openFile: ((filePath: string, flags: number) => Promise<FileHandle>) | undefined,
): Promise<ValidatedBinding> {
  const rootPath = path.resolve(root.path)
  const skillPath = path.join(rootPath, skillName)
  const envPath = path.join(skillPath, ".env")
  const skillMdPath = path.join(skillPath, "SKILL.md")
  if (envPath !== path.resolve(expectedEnvPath) || path.dirname(skillPath) !== rootPath) {
    throw new UnsafeBindingError("unsafe containment")
  }

  const [rootInfo, skillInfo, skillMdInfo, envInfo] = await Promise.all([
    lstat(rootPath),
    lstat(skillPath),
    lstat(skillMdPath),
    lstat(envPath),
  ])
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()
    || !skillInfo.isDirectory() || skillInfo.isSymbolicLink()
    || !skillMdInfo.isFile() || skillMdInfo.isSymbolicLink()
    || !envInfo.isFile() || envInfo.isSymbolicLink()) {
    throw new UnsafeBindingError("unsafe file type")
  }

  const [rootRealPath, skillRealPath, skillMdRealPath, envRealPath] = await Promise.all([
    realpath(rootPath),
    realpath(skillPath),
    realpath(skillMdPath),
    realpath(envPath),
  ])
  if (path.dirname(skillRealPath) !== rootRealPath
    || path.dirname(skillMdRealPath) !== skillRealPath
    || path.dirname(envRealPath) !== skillRealPath) {
    throw new UnsafeBindingError("unsafe real path")
  }
  const noFollowFlag = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  let handle: FileHandle | undefined
  try {
    handle = await (openFile ?? open)(envPath, mode === "write"
      ? constants.O_RDWR | noFollowFlag
      : constants.O_RDONLY | noFollowFlag)
    const handleStat = await handle.stat()
    const pathStat = await lstat(envPath)
    if (!handleStat.isFile() || pathStat.isSymbolicLink() || !sameIdentity(handleStat, pathStat)) {
      throw new UnsafeBindingError("file identity changed")
    }
    const [rootAfter, skillAfter, envRealAfter] = await Promise.all([
      lstat(rootPath),
      lstat(skillPath),
      realpath(envPath),
    ])
    const [rootRealAfter, skillRealAfter] = await Promise.all([
      realpath(rootPath),
      realpath(skillPath),
    ])
    if (rootAfter.isSymbolicLink() || skillAfter.isSymbolicLink()
      || !sameIdentity(rootInfo, rootAfter)
      || !sameIdentity(skillInfo, skillAfter)
      || rootRealAfter !== rootRealPath
      || skillRealAfter !== skillRealPath
      || path.dirname(envRealAfter) !== skillRealPath) {
      throw new UnsafeBindingError("parent identity changed")
    }
    const content = await handle.readFile("utf8")
    return {
      handle,
      content,
      envPath: envRealPath,
      mode: handleStat.mode,
      rootIdentity: toFileIdentity(rootInfo),
      skillIdentity: toFileIdentity(skillInfo),
      envIdentity: toFileIdentity(handleStat),
      rootRealPath,
      skillRealPath,
      envRealPath,
    }
  } catch (error) {
    await handle?.close().catch(() => undefined)
    if (error instanceof UnsafeBindingError) throw error
    const causeCode = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined
    throw new BindingIoError(error instanceof Error ? error.message : "I/O failure", causeCode)
  }
}

async function rootStillTrusted(
  scanned: TrustedSkillRoot,
  currentRoots: readonly TrustedSkillRoot[],
): Promise<boolean> {
  let scannedRealPath: string
  try {
    scannedRealPath = await realpath(scanned.path)
  } catch {
    return false
  }
  for (const current of currentRoots) {
    if (current.scope !== scanned.scope || current.projectId !== scanned.projectId) continue
    try {
      if (await realpath(current.path) === scannedRealPath) return true
    } catch {
      continue
    }
  }
  return false
}

async function bindingStillMatches(stored: StoredBinding): Promise<boolean> {
  if (!stored.rootIdentity || !stored.skillIdentity || !stored.envIdentity
    || !stored.rootRealPath || !stored.skillRealPath || !stored.envRealPath) return false
  const rootPath = path.resolve(stored.root.path)
  const skillPath = path.dirname(stored.publicItem.envPath)
  try {
    const [rootInfo, skillInfo, envInfo] = await Promise.all([
      lstat(rootPath),
      lstat(skillPath),
      lstat(stored.publicItem.envPath),
    ])
    if (rootInfo.isSymbolicLink() || skillInfo.isSymbolicLink() || envInfo.isSymbolicLink()) {
      throw new UnsafeBindingError("unsafe binding path")
    }
    if (!rootInfo.isDirectory() || !skillInfo.isDirectory() || !envInfo.isFile()) return false
    if (!sameIdentity(stored.rootIdentity, toFileIdentity(rootInfo))
      || !sameIdentity(stored.skillIdentity, toFileIdentity(skillInfo))
      || !sameIdentity(stored.envIdentity, toFileIdentity(envInfo))) return false
    const [rootRealPath, skillRealPath, envRealPath] = await Promise.all([
      realpath(rootPath),
      realpath(skillPath),
      realpath(stored.publicItem.envPath),
    ])
    if (rootRealPath !== stored.rootRealPath
      || skillRealPath !== stored.skillRealPath
      || envRealPath !== stored.envRealPath
      || path.dirname(skillRealPath) !== rootRealPath
      || path.dirname(envRealPath) !== skillRealPath) {
      throw new UnsafeBindingError("unsafe binding containment")
    }
    return true
  } catch (error) {
    if (error instanceof UnsafeBindingError) throw error
    return false
  }
}

async function isWritable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

async function writeFileHandleFully(handle: FileHandle, content: string): Promise<void> {
  const data = Buffer.from(content, "utf8")
  let offset = 0
  while (offset < data.length) {
    const result = await handle.write(data, offset, data.length - offset, offset)
    if (result.bytesWritten <= 0) throw new BindingIoError("zero progress while writing")
    offset += result.bytesWritten
  }
}

function toFileIdentity(stats: {
  dev: number
  ino: number
  size: number
  mtimeMs: number
  ctimeMs: number
  birthtimeMs: number
}): FileIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
    birthtimeMs: stats.birthtimeMs,
  }
}

function sameIdentity(left: {
  dev: number
  ino: number
  size?: number
  mtimeMs?: number
  ctimeMs?: number
  birthtimeMs?: number
}, right: {
  dev: number
  ino: number
  size?: number
  mtimeMs?: number
  ctimeMs?: number
  birthtimeMs?: number
}): boolean {
  if (left.dev !== 0 && right.dev !== 0 && left.ino !== 0 && right.ino !== 0) {
    return left.dev === right.dev && left.ino === right.ino
  }
  return left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.birthtimeMs === right.birthtimeMs
}

function isPermissionLikeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const code = error instanceof BindingIoError ? error.causeCode : "code" in error ? error.code : undefined
  return code === "EACCES" || code === "EPERM" || code === "EROFS"
}

function isNotFoundLikeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const code = error instanceof BindingIoError ? error.causeCode : "code" in error ? error.code : undefined
  return code === "ENOENT" || code === "ENOTDIR"
}
