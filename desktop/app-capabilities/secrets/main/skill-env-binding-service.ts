import { createHash, randomUUID } from "node:crypto"
import { access, constants, lstat, readFile, readdir, realpath, stat } from "node:fs/promises"
import path from "node:path"

import type { ActorIdentity, AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { replaceFileAtomically } from "../../../electron/services/editor-file-write-utils"
import type { TrustedSkillRoot } from "../../../electron/services/editor-scan-roots"
import { parseDotenvDocument, patchDotenvValues } from "../../../electron/services/skill-env/dotenv-document"
import type {
  SecretSkillEnvApplyInput,
  SecretSkillEnvApplyResult,
  SecretSkillEnvScanResult,
  SkillEnvBindingApplyItem,
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
}

type StoredBinding = {
  readonly publicItem: SkillEnvBindingItem
  readonly root: TrustedSkillRoot
  readonly fileHash: string | null
}

type ScanSession = {
  readonly createdAt: number
  readonly name: string
  readonly items: ReadonlyMap<string, StoredBinding>
}

type ValidatedBinding = {
  readonly content: string
  readonly envPath: string
  readonly mode: number
}

export function createSkillEnvBindingService(deps: SkillEnvBindingServiceDeps) {
  const sessions = new Map<string, ScanSession>()
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

  async function apply(
    input: SecretSkillEnvApplyInput,
    value: string,
    security: SkillEnvBindingSecurity,
  ): Promise<SecretSkillEnvApplyResult> {
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
    const results: SkillEnvBindingApplyItem[] = []
    for (const stored of selected as StoredBinding[]) {
      results.push(await applyOne(stored, input.name, value, currentRoots, security))
    }
    return { items: results }
  }

  async function scanRoot(
    root: TrustedSkillRoot,
    name: string,
    value: string,
  ): Promise<StoredBinding[]> {
    let entries
    try {
      const rootInfo = await stat(root.path)
      if (!rootInfo.isDirectory()) return []
      entries = await readdir(root.path, { withFileTypes: true })
    } catch {
      deps.logger.warn("Failed to scan trusted Skill root.", { scope: root.scope })
      return []
    }

    const items: StoredBinding[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const skillName = entry.name
      const skillPath = path.join(root.path, skillName)
      const envPath = path.join(skillPath, ".env")
      const skillMdPath = path.join(skillPath, "SKILL.md")
      let skillInfo
      let envInfo
      try {
        ;[skillInfo, envInfo] = await Promise.all([lstat(skillMdPath), lstat(envPath)])
      } catch {
        continue
      }
      if (!skillInfo.isFile() || skillInfo.isSymbolicLink()) continue

      const base = createPublicItem(createId(), root, skillName, envPath)
      if (envInfo.isSymbolicLink()) {
        items.push({
          publicItem: { ...base, status: "unsafe_link", message: "配置文件是符号链接。" },
          root,
          fileHash: null,
        })
        continue
      }
      if (!envInfo.isFile()) continue

      let content: string
      try {
        const validated = await validateBindingPath(root, skillName, envPath)
        content = validated.content
      } catch {
        items.push({
          publicItem: { ...base, status: "unsafe_link", message: "配置文件路径不安全。" },
          root,
          fileHash: null,
        })
        continue
      }

      const fileHash = hashContent(content)
      try {
        const document = parseDotenvDocument(content)
        const match = document.entries.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())
        if (!match) continue
        if (match.value === value) {
          items.push({ publicItem: { ...base, status: "up_to_date" }, root, fileHash })
          continue
        }
        const writable = (envInfo.mode & 0o222) !== 0 && await isWritable(envPath)
        items.push({
          publicItem: writable
            ? { ...base, status: "needs_update" }
            : { ...base, status: "unwritable", message: "配置文件不可写。" },
          root,
          fileHash,
        })
      } catch {
        items.push({
          publicItem: { ...base, status: "invalid", message: "配置文件格式无效。" },
          root,
          fileHash,
        })
      }
    }
    return items
  }

  async function applyOne(
    stored: StoredBinding,
    name: string,
    value: string,
    currentRoots: readonly TrustedSkillRoot[],
    security: SkillEnvBindingSecurity,
  ): Promise<SkillEnvBindingApplyItem> {
    const base = applyItemBase(stored.publicItem)
    const auditMetadata = {
      operation: "skill-env-binding-apply",
      secretName: name,
      editorIds: stored.publicItem.editors.map(({ id }) => id),
      scope: stored.publicItem.scope,
      skillName: stored.publicItem.skillName,
    }

    try {
      if (!(await allowRootRead(stored.root, security, "skill-env-binding-apply-revalidate"))) {
        return recordApplyResult(base, "failed", "没有读取该位置的权限。", security, auditMetadata, "denied")
      }
      if (!stored.fileHash || !(await rootStillTrusted(stored.root, currentRoots))) {
        return recordApplyResult(base, "conflict", "扫描结果已失效。", security, auditMetadata)
      }
      const validated = await validateBindingPath(
        stored.root,
        stored.publicItem.skillName,
        stored.publicItem.envPath,
      )
      if (hashContent(validated.content) !== stored.fileHash) {
        return recordApplyResult(base, "conflict", "配置文件已发生变化。", security, auditMetadata)
      }
      if ((validated.mode & 0o222) === 0 || !(await isWritable(validated.envPath))) {
        return recordApplyResult(base, "failed", "配置文件不可写。", security, auditMetadata)
      }

      const document = parseDotenvDocument(validated.content)
      const matches = document.entries.filter((entry) => entry.name.toLowerCase() === name.toLowerCase())
      if (matches.length !== 1) {
        return recordApplyResult(base, "conflict", "配置键已发生变化。", security, auditMetadata)
      }
      const nextContent = patchDotenvValues(validated.content, { [matches[0].name]: value })
      const permission = await security.permissionGuard.check({
        action: "fs.write",
        actor: security.actor,
        resource: validated.envPath,
        context: auditMetadata,
      })
      if (!permission.allowed) {
        return recordApplyResult(base, "failed", "没有写入该位置的权限。", security, {
          ...auditMetadata,
          policyId: permission.policyId,
        }, "denied")
      }
      await replaceFileAtomically(validated.envPath, nextContent)
      return recordApplyResult(base, "updated", undefined, security, auditMetadata)
    } catch {
      deps.logger.warn("Failed to apply Skill env binding.", {
        scope: stored.publicItem.scope,
        skillName: stored.publicItem.skillName,
      })
      return recordApplyResult(base, "conflict", "配置文件已发生变化或不再安全。", security, auditMetadata, "failed")
    }
  }

  return { scan, apply }
}

export type SkillEnvBindingService = ReturnType<typeof createSkillEnvBindingService>

async function allowRootRead(
  root: TrustedSkillRoot,
  security: SkillEnvBindingSecurity,
  operation: "skill-env-binding-scan" | "skill-env-binding-apply-revalidate",
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

function applyItemBase(item: SkillEnvBindingItem): Omit<SkillEnvBindingApplyItem, "status"> {
  const { status: _status, ...base } = item
  return base
}

function recordApplyResult(
  base: Omit<SkillEnvBindingApplyItem, "status">,
  status: SkillEnvBindingApplyItem["status"],
  message: string | undefined,
  security: SkillEnvBindingSecurity,
  metadata: Record<string, unknown>,
  auditOutcome: "allowed" | "denied" | "failed" = status === "updated" ? "allowed" : "failed",
): SkillEnvBindingApplyItem {
  security.auditSink.record({
    action: "fs.write",
    actor: security.actor,
    resource: base.envPath,
    outcome: auditOutcome,
    metadata: { ...metadata, outcome: status },
  })
  return { ...base, status, ...(message ? { message } : undefined) }
}

async function validateBindingPath(
  root: TrustedSkillRoot,
  skillName: string,
  expectedEnvPath: string,
): Promise<ValidatedBinding> {
  const rootPath = path.resolve(root.path)
  const skillPath = path.join(rootPath, skillName)
  const envPath = path.join(skillPath, ".env")
  const skillMdPath = path.join(skillPath, "SKILL.md")
  if (envPath !== path.resolve(expectedEnvPath) || path.dirname(skillPath) !== rootPath) {
    throw new Error("unsafe containment")
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
    throw new Error("unsafe file type")
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
    throw new Error("unsafe real path")
  }
  return { content: await readFile(envRealPath, "utf8"), envPath: envRealPath, mode: envInfo.mode }
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
