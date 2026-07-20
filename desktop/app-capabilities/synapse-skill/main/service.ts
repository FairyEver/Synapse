import { createHash, randomUUID } from "node:crypto"
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { app } from "electron"
import {
  SYNAPSE_SKILL_PREPARED_SOURCE_MAX_ENTRIES,
  SYNAPSE_SKILL_PREPARED_SOURCE_TTL_MS,
} from "../../../config"
import { parseFrontmatterBlock } from "../../../src/definitions/editor/shared-yaml-scalar"
import type { SynapseContentDetail } from "../../../src/types/content"
import {
  readSkillDraftFromDirectory,
  type ContentSkillSourceDraft,
} from "../../../electron/services/content-skill-source-service"
import {
  SYNAPSE_SKILL_NAME,
  SYNAPSE_SKILL_PREPARED_SOURCE_PREFIX,
  SYNAPSE_SKILL_SOURCE_IDENTITY,
  SYNAPSE_SKILL_TITLE,
} from "../shared/capability"
import type { SynapseSkillInstallerSource } from "../shared/schema"

type SynapseSkillServiceDeps = {
  readonly createId?: () => string
  readonly maxPreparedSources?: number
  readonly now?: () => number
  readonly packageRoot?: string
  readonly preparedSourceTtlMs?: number
}

type PreparedSynapseSkill = {
  lastAccessedAt: number
  readonly packageRoot: string
  readonly source: SynapseSkillInstallerSource
}

function defaultPackageRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "synapse-skill")
  }

  return path.join(app.getAppPath(), "app-capabilities", "synapse-skill", "skill-package")
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

async function listPackageFiles(rootPath: string, currentPath = rootPath): Promise<string[]> {
  const entries = await readdir(currentPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(currentPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listPackageFiles(rootPath, fullPath))
    } else if (entry.isFile()) {
      files.push(path.relative(rootPath, fullPath).split(path.sep).join("/"))
    }
  }

  return files.sort((left, right) => left.localeCompare(right))
}

async function computePackageFingerprint(rootPath: string): Promise<string> {
  const files = await listPackageFiles(rootPath)
  const hash = createHash("sha256")

  for (const relativePath of files) {
    const bytes = await readFile(path.join(rootPath, relativePath))
    hash.update(relativePath)
    hash.update("\0")
    hash.update(String(bytes.byteLength))
    hash.update("\0")
    hash.update(bytes)
    hash.update("\0")
  }

  return `sha256:${hash.digest("hex")}`
}

function stripSkillFrontmatter(content: string): string {
  if (!content.startsWith("---")) {
    return content.trim()
  }

  const endIndex = content.indexOf("\n---", 3)
  if (endIndex === -1) {
    return content.trim()
  }

  parseFrontmatterBlock(content.slice(4, endIndex))
  return content.slice(endIndex + 4).trim()
}

class SynapseSkillService {
  private readonly createId: () => string
  private readonly maxPreparedSources: number
  private readonly now: () => number
  private readonly packageRoot: string
  private readonly preparedSourceTtlMs: number
  private readonly preparedById = new Map<string, PreparedSynapseSkill>()
  private readonly installingSourceCounts = new Map<string, number>()
  private readonly releaseAfterInstallSourceIds = new Set<string>()
  private readonly releaseTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(deps: SynapseSkillServiceDeps = {}) {
    this.createId = deps.createId ?? randomUUID
    this.maxPreparedSources = deps.maxPreparedSources ?? SYNAPSE_SKILL_PREPARED_SOURCE_MAX_ENTRIES
    this.now = deps.now ?? Date.now
    this.packageRoot = deps.packageRoot ?? defaultPackageRoot()
    this.preparedSourceTtlMs = deps.preparedSourceTtlMs ?? SYNAPSE_SKILL_PREPARED_SOURCE_TTL_MS
  }

  async prepareInstallSource(): Promise<SynapseSkillInstallerSource> {
    const timestamp = this.now()
    this.prunePreparedSources(timestamp)
    const draft = await this.readDraft()
    const preparedSourceId = `${SYNAPSE_SKILL_PREPARED_SOURCE_PREFIX}${this.createId()}`
    const sourceFingerprint = await computePackageFingerprint(this.packageRoot)
    const source: SynapseSkillInstallerSource = {
      kind: "skill",
      origin: "prepared",
      sourceIdentity: SYNAPSE_SKILL_SOURCE_IDENTITY,
      name: SYNAPSE_SKILL_NAME,
      title: SYNAPSE_SKILL_TITLE,
      description: draft.metadata.description?.trim() ?? "",
      preparedSourceId,
      mainContent: draft.content,
      sourceFingerprint,
    }

    this.preparedById.set(preparedSourceId, {
      lastAccessedAt: this.now(),
      packageRoot: this.packageRoot,
      source,
    })
    this.enforcePreparedSourceCapacity(preparedSourceId)
    return source
  }

  hasPreparedSource(sourceId: string, contentId: string): boolean {
    if (contentId !== SYNAPSE_SKILL_SOURCE_IDENTITY) return false
    return this.getPrepared(sourceId) !== undefined
  }

  async readPreparedSkill(
    sourceId: string,
    contentId: string,
  ): Promise<SynapseContentDetail<"skill">> {
    const prepared = this.requirePrepared(sourceId, contentId)
    const draft = await this.readDraft()
    const now = new Date(0).toISOString()

    const detail: SynapseContentDetail<"skill"> & { sourceFingerprint: string } = {
      attachmentCount: draft.files.length,
      attachments: draft.files.map((file) => ({
        originalName: file.originalName,
        sha256: file.sha256 ?? sha256(file.bytes ?? new Uint8Array()),
        size: file.size,
      })),
      category: "system",
      content: stripSkillFrontmatter(draft.content),
      createdAt: now,
      createdBy: "synapse",
      createdByDisplayName: "Synapse",
      deleted: false,
      description: draft.metadata.description?.trim() ?? "",
      icon: "",
      iconBg: "",
      id: SYNAPSE_SKILL_SOURCE_IDENTITY,
      latestHistoryDirname: "system",
      modifiedAt: now,
      modifiedBy: "synapse",
      modifiedByDisplayName: "Synapse",
      name: SYNAPSE_SKILL_NAME,
      title: SYNAPSE_SKILL_TITLE,
      type: "skill",
      sourceFingerprint: prepared.source.sourceFingerprint,
    }
    return detail
  }

  async copyPreparedSkillAttachment(
    sourceId: string,
    contentId: string,
    relativePath: string,
    targetPath: string,
  ): Promise<void> {
    this.requirePrepared(sourceId, contentId)
    const draft = await this.readDraft()
    const attachment = draft.files.find((file) => file.originalName === relativePath)
    if (!attachment) {
      throw new Error("Synapse Skill 附件不可用。")
    }

    await mkdir(path.dirname(targetPath), { recursive: true })
    await copyFile(path.join(this.packageRoot, attachment.originalName), targetPath)
  }

  async readPreparedSkillAttachmentText(
    sourceId: string,
    contentId: string,
    relativePath: string,
  ): Promise<string | null> {
    this.requirePrepared(sourceId, contentId)
    const draft = await this.readDraft()
    const attachment = draft.files.find((file) => file.originalName === relativePath)
    if (!attachment) return null
    return readFile(path.join(this.packageRoot, attachment.originalName), "utf8")
  }

  beginPreparedInstall(sourceId: string, contentId: string): Promise<void> {
    this.requirePrepared(sourceId, contentId)
    const releaseTimer = this.releaseTimers.get(sourceId)
    if (releaseTimer) {
      clearTimeout(releaseTimer)
      this.releaseTimers.delete(sourceId)
    }
    this.installingSourceCounts.set(sourceId, (this.installingSourceCounts.get(sourceId) ?? 0) + 1)
    return Promise.resolve()
  }

  endPreparedInstall(sourceId: string, contentId: string): Promise<void> {
    this.requirePrepared(sourceId, contentId)
    const remainingInstalls = Math.max((this.installingSourceCounts.get(sourceId) ?? 1) - 1, 0)
    if (remainingInstalls > 0) {
      this.installingSourceCounts.set(sourceId, remainingInstalls)
    } else {
      this.installingSourceCounts.delete(sourceId)
    }
    if (remainingInstalls === 0 && this.releaseAfterInstallSourceIds.has(sourceId)) {
      const existingTimer = this.releaseTimers.get(sourceId)
      if (existingTimer) clearTimeout(existingTimer)
      const releaseTimer = setTimeout(() => {
        this.releaseTimers.delete(sourceId)
        if (!this.installingSourceCounts.has(sourceId)) {
          this.deletePreparedSource(sourceId)
        }
      }, 0)
      this.releaseTimers.set(sourceId, releaseTimer)
    }
    return Promise.resolve()
  }

  markPreparedInstalled(sourceId: string, contentId: string): Promise<void> {
    this.requirePrepared(sourceId, contentId)
    return Promise.resolve()
  }

  releaseInstallSource(sourceId: string): Promise<void> {
    if (!this.preparedById.has(sourceId)) return Promise.resolve()
    if (this.installingSourceCounts.has(sourceId)) {
      this.releaseAfterInstallSourceIds.add(sourceId)
      return Promise.resolve()
    }
    this.deletePreparedSource(sourceId)
    return Promise.resolve()
  }

  private readDraft(): Promise<ContentSkillSourceDraft> {
    return readSkillDraftFromDirectory(this.packageRoot)
  }

  private requirePrepared(sourceId: string, contentId: string): PreparedSynapseSkill {
    const prepared = this.getPrepared(sourceId)
    if (!prepared || contentId !== SYNAPSE_SKILL_SOURCE_IDENTITY) {
      throw new Error("Synapse Skill 安装源不可用。")
    }
    return prepared
  }

  private getPrepared(sourceId: string): PreparedSynapseSkill | undefined {
    const timestamp = this.now()
    this.prunePreparedSources(timestamp)
    const prepared = this.preparedById.get(sourceId)
    if (!prepared) return undefined
    prepared.lastAccessedAt = timestamp
    this.preparedById.delete(sourceId)
    this.preparedById.set(sourceId, prepared)
    return prepared
  }

  private prunePreparedSources(timestamp: number): void {
    for (const [sourceId, prepared] of this.preparedById) {
      if (
        !this.installingSourceCounts.has(sourceId)
        && timestamp - prepared.lastAccessedAt >= this.preparedSourceTtlMs
      ) {
        this.deletePreparedSource(sourceId)
      }
    }
  }

  private enforcePreparedSourceCapacity(protectedSourceId: string): void {
    while (this.preparedById.size > this.maxPreparedSources) {
      const candidate = Array.from(this.preparedById.keys())
        .find((sourceId) => sourceId !== protectedSourceId && !this.installingSourceCounts.has(sourceId))
      if (!candidate) {
        this.deletePreparedSource(protectedSourceId)
        throw new Error("Synapse Skill 安装源缓存正忙，请稍后重试。")
      }
      this.deletePreparedSource(candidate)
    }
  }

  private deletePreparedSource(sourceId: string): void {
    const releaseTimer = this.releaseTimers.get(sourceId)
    if (releaseTimer) clearTimeout(releaseTimer)
    this.releaseTimers.delete(sourceId)
    this.preparedById.delete(sourceId)
    this.installingSourceCounts.delete(sourceId)
    this.releaseAfterInstallSourceIds.delete(sourceId)
  }
}

function createSynapseSkillService(deps?: SynapseSkillServiceDeps): SynapseSkillService {
  return new SynapseSkillService(deps)
}

export {
  SynapseSkillService,
  computePackageFingerprint,
  createSynapseSkillService,
  type SynapseSkillServiceDeps,
}
