import { createHash, randomUUID } from "node:crypto"
import { mkdir, realpath, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  INSTALLER_SOURCE_LOCAL_SKILL_CACHE_MAX_BYTES,
  INSTALLER_SOURCE_LOCAL_SKILL_CACHE_MAX_ENTRIES,
  INSTALLER_SOURCE_TTL_MS,
} from "../../config"
import { parseFrontmatterBlock } from "../../src/definitions/editor/shared-yaml-scalar"
import { slugifySkillName } from "../../src/definitions/editor/shared-skill-frontmatter"
import { normalizeContentNameInput, validateContentNameInput } from "../../src/lib/content-name-input"
import { normalizeSkillNameInput, validateSkillNameInput } from "../../src/lib/skill-name-input"
import { SKILL_ENV_EXAMPLE_PATH } from "../../src/lib/content-attachments"
import type { SynapseContentDetail } from "../../src/types/content"
import type {
  SynapsePrepareInlineRuleSourcePayload,
  SynapsePrepareLocalSkillSourcePayload,
  SynapseInstallerSource,
  SynapseRuleInstallerSource,
  SynapseSkillInstallerSource,
} from "../../src/types/installers"
import {
  readSkillDraftFromDirectory,
  resolveRootSkillMainFile,
  type ContentSkillSourceDraft,
} from "./content-skill-source-service"
import {
  createInlineRuleSourceIdentity,
  createLocalSkillSourceIdentity,
} from "./installer-source-identity"
import { assertSkillRuntimeEnvByteLength } from "./skill-env/file-policy"

type StoredLocalSkillSource = {
  byteLength: number
  lastAccessedAt: number
  draft: ContentSkillSourceDraft
  source: SynapseSkillInstallerSource
}

type StoredInlineRuleSource = {
  lastAccessedAt: number
  source: SynapseRuleInstallerSource
}

type InstallerSourceServiceOptions = {
  readonly maxLocalSkillBytes?: number
  readonly maxLocalSkillEntries?: number
  readonly now?: () => number
  readonly sourceTtlMs?: number
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function parseSkillContent(text: string): string {
  if (!text.startsWith("---")) return text.trim()

  const endIndex = text.indexOf("\n---", 3)
  if (endIndex === -1) return text.trim()

  parseFrontmatterBlock(text.slice(4, endIndex))
  return text.slice(endIndex + 4).trim()
}

class InstallerSourceService {
  private readonly inlineRules = new Map<string, StoredInlineRuleSource>()
  private readonly localSkills = new Map<string, StoredLocalSkillSource>()

  constructor(private readonly options: InstallerSourceServiceOptions = {}) {}

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private pruneSources(timestamp = this.now()): void {
    const ttlMs = this.options.sourceTtlMs ?? INSTALLER_SOURCE_TTL_MS
    for (const [id, stored] of this.localSkills) {
      if (timestamp - stored.lastAccessedAt >= ttlMs) this.localSkills.delete(id)
    }
    for (const [id, stored] of this.inlineRules) {
      if (timestamp - stored.lastAccessedAt >= ttlMs) this.inlineRules.delete(id)
    }
  }

  private enforceLocalSkillBudget(): void {
    const maxEntries = this.options.maxLocalSkillEntries ?? INSTALLER_SOURCE_LOCAL_SKILL_CACHE_MAX_ENTRIES
    const maxBytes = this.options.maxLocalSkillBytes ?? INSTALLER_SOURCE_LOCAL_SKILL_CACHE_MAX_BYTES
    let totalBytes = Array.from(this.localSkills.values())
      .reduce((total, stored) => total + stored.byteLength, 0)
    while (this.localSkills.size > maxEntries || totalBytes > maxBytes) {
      const oldest = this.localSkills.entries().next().value as [string, StoredLocalSkillSource] | undefined
      if (!oldest) break
      this.localSkills.delete(oldest[0])
      totalBytes -= oldest[1].byteLength
    }
  }

  async prepareLocalSkillSource(
    payload: SynapsePrepareLocalSkillSourcePayload,
  ): Promise<SynapseSkillInstallerSource> {
    const timestamp = this.now()
    this.pruneSources(timestamp)
    const rootMainFile = await resolveRootSkillMainFile(payload.sourceDirectoryPath)
    if (!rootMainFile || path.basename(rootMainFile) !== "SKILL.md") {
      throw new Error("Skill 安装器需要根目录 SKILL.md。")
    }

    const draft = await readSkillDraftFromDirectory(payload.sourceDirectoryPath)
    const realSourceDirectoryPath = await realpath(draft.sourceDirectoryPath)
    const fallbackName = slugifySkillName(path.basename(realSourceDirectoryPath), "synapse-skill")
    const metadataName = normalizeSkillNameInput(draft.metadata.name ?? "")
    const name = validateSkillNameInput(metadataName) === null
      ? metadataName
      : fallbackName
    const nameError = validateSkillNameInput(name)
    if (nameError) {
      throw new Error(nameError)
    }

    const localSourceId = randomUUID()
    const source: SynapseSkillInstallerSource = {
      kind: "skill",
      origin: "local-directory",
      sourceIdentity: createLocalSkillSourceIdentity(realSourceDirectoryPath),
      localSourceId,
      name,
      title: draft.metadata.title?.trim() || name,
      description: draft.metadata.description?.trim() ?? "",
      mainContent: draft.content,
    }

    this.localSkills.set(localSourceId, {
      byteLength: Buffer.byteLength(draft.content, "utf8")
        + draft.files.reduce((total, file) => total + (file.bytes?.byteLength ?? 0), 0),
      lastAccessedAt: timestamp,
      draft,
      source,
    })
    this.enforceLocalSkillBudget()
    return source
  }

  async prepareInlineRuleSource(
    payload: SynapsePrepareInlineRuleSourcePayload,
  ): Promise<SynapseRuleInstallerSource> {
    const timestamp = this.now()
    this.pruneSources(timestamp)
    const name = normalizeContentNameInput(payload.name)
    const nameError = validateContentNameInput(name)
    if (nameError) {
      throw new Error(nameError)
    }

    const body = payload.body.trim()
    if (!body) {
      throw new Error("Rule 正文不能为空。")
    }

    const inlineSourceId = randomUUID()
    const source: SynapseRuleInstallerSource = {
      kind: "rule",
      origin: "inline",
      sourceIdentity: createInlineRuleSourceIdentity(name, body),
      inlineSourceId,
      name,
      title: name,
      description: "",
      body,
    }

    this.inlineRules.set(inlineSourceId, { lastAccessedAt: timestamp, source })
    return source
  }

  getInlineRule(inlineSourceId: string): StoredInlineRuleSource {
    const timestamp = this.now()
    this.pruneSources(timestamp)
    const stored = this.inlineRules.get(inlineSourceId)
    if (!stored) {
      throw new Error("Rule 安装源不可用。")
    }
    stored.lastAccessedAt = timestamp
    this.inlineRules.delete(inlineSourceId)
    this.inlineRules.set(inlineSourceId, stored)
    return stored
  }

  getLocalSkill(localSourceId: string): StoredLocalSkillSource {
    const timestamp = this.now()
    this.pruneSources(timestamp)
    const stored = this.localSkills.get(localSourceId)
    if (!stored) {
      throw new Error("本地 Skill 安装源不可用。")
    }
    stored.lastAccessedAt = timestamp
    this.localSkills.delete(localSourceId)
    this.localSkills.set(localSourceId, stored)
    return stored
  }

  releaseSource(source: SynapseInstallerSource): void {
    if (source.kind === "skill" && source.localSourceId) {
      this.localSkills.delete(source.localSourceId)
    }
    if (source.kind === "rule" && source.inlineSourceId) {
      this.inlineRules.delete(source.inlineSourceId)
    }
  }

  async readInlineRule(source: SynapseRuleInstallerSource): Promise<string> {
    if (source.inlineSourceId) {
      return this.getInlineRule(source.inlineSourceId).source.body ?? ""
    }
    if (source.body?.trim()) {
      return source.body
    }
    throw new Error("Rule 安装源不可用。")
  }

  async readLocalSkill(source: SynapseSkillInstallerSource): Promise<SynapseContentDetail<"skill">> {
    if (!source.localSourceId) {
      throw new Error("本地 Skill 安装源不可用。")
    }
    const stored = this.getLocalSkill(source.localSourceId)
    const now = new Date(0).toISOString()
    return {
      attachmentCount: stored.draft.files.length,
      attachments: stored.draft.files.map((file) => ({
        originalName: file.originalName,
        sha256: file.sha256 ?? sha256(file.bytes ?? new Uint8Array()),
        size: file.size,
      })),
      category: "installer",
      content: parseSkillContent(stored.draft.content),
      createdAt: now,
      createdBy: "installer",
      createdByDisplayName: "Installer",
      deleted: false,
      description: source.description ?? "",
      icon: "",
      iconBg: "",
      id: source.sourceIdentity,
      latestHistoryDirname: "local",
      modifiedAt: now,
      modifiedBy: "installer",
      modifiedByDisplayName: "Installer",
      name: source.name,
      title: source.title ?? source.name,
      type: "skill",
    }
  }

  async copyLocalSkillAttachment(
    source: SynapseSkillInstallerSource,
    relativePath: string,
    targetPath: string,
  ): Promise<void> {
    if (!source.localSourceId) {
      throw new Error("本地 Skill 安装源不可用。")
    }
    const stored = this.getLocalSkill(source.localSourceId)
    const file = stored.draft.files.find((candidate) => candidate.originalName === relativePath)
    if (!file?.bytes) {
      throw new Error("本地 Skill 附件不可用。")
    }
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, file.bytes)
  }

  async readLocalSkillAttachmentText(
    source: SynapseSkillInstallerSource,
    relativePath: string,
  ): Promise<string | null> {
    if (!source.localSourceId) {
      throw new Error("本地 Skill 安装源不可用。")
    }
    const stored = this.getLocalSkill(source.localSourceId)
    const file = stored.draft.files.find((candidate) => candidate.originalName === relativePath)
    if (!file?.bytes) return null
    if (relativePath === SKILL_ENV_EXAMPLE_PATH) {
      assertSkillRuntimeEnvByteLength(file.bytes.byteLength)
    }
    return Buffer.from(file.bytes).toString("utf8")
  }
}

const installerSourceService = new InstallerSourceService()

export {
  InstallerSourceService,
  installerSourceService,
}
