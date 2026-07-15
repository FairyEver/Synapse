import path from "node:path"

import type {
  SkillRepositoryDetailDto,
  SkillRepositoryImportInput,
} from "@synapse/shared" with { "resolution-mode": "import" }
import type { SynapseAccountState } from "../../src/types/account"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../generated/deployment-config.generated"
import {
  readSkillDraftFromDirectory,
  type ContentSkillSourceDraft,
  type ContentSkillSourceSecurityDeps,
} from "./content-skill-source-service"
import { AccountAuthenticationRequiredError, accountService } from "./account-service"
import {
  ensureSkillRepositoryIdentityWriteAllowed,
  readSkillRepositoryIdentity,
  readSkillRepositoryIdentityRaw,
  removeLegacySkillRepositoryIdentity,
  writeSkillRepositoryIdentity,
  type SkillRepositoryIdentityWriteSecurity,
} from "./skill-repository-local-identity"

const sharedSkillRepositoryPromise = import("@synapse/shared")

export type SkillRepositoryLocalImportInput = {
  readonly sourceDirectoryPath: string
  readonly repositoryId?: string | null
  readonly name?: string | null
  readonly title?: string | null
  readonly description?: string | null
  readonly expectedSourceFingerprint?: string
  readonly openInBrowser?: boolean
}

export type SkillRepositoryLocalImportResult = {
  readonly repositoryId: string
  readonly name: string
  readonly owner: string | null
  readonly managementUrl: string
  readonly identityWritten: boolean
  readonly identityWriteError?: string
  readonly identityBeforeUploadId?: string | null
  readonly identityMigrated: boolean
  readonly identityMigrationWarning?: string
  readonly sourceImportSummary: ContentSkillSourceDraft["sourceImportSummary"]
}

export type SkillRepositoryLocalIdentityRetryInput = {
  readonly sourceDirectoryPath: string
  readonly repositoryId: string
  readonly name: string
  readonly owner: string | null
  readonly expectedSourceFingerprint: string
  readonly expectedIdentityId: string | null
}

export type SkillRepositoryLocalIdentityRetryResult = {
  readonly identityWritten: true
  readonly identityMigrated: boolean
  readonly identityMigrationWarning?: string
}

type SkillRepositoryUploadAccountPort = {
  readonly getState: () => SynapseAccountState
  readonly importSkillRepository: (input: SkillRepositoryImportInput) => Promise<SkillRepositoryDetailDto>
}

type SkillRepositoryUploadServiceDeps = {
  readonly accountService?: SkillRepositoryUploadAccountPort
  readonly publicAppUrl?: string
  readonly openExternal?: (url: string) => Promise<void> | void
  readonly ensureIdentityWriteAllowed?: typeof ensureSkillRepositoryIdentityWriteAllowed
  readonly readIdentity?: typeof readSkillRepositoryIdentity
  readonly readIdentityRaw?: typeof readSkillRepositoryIdentityRaw
  readonly removeLegacyIdentity?: typeof removeLegacySkillRepositoryIdentity
  readonly writeIdentity?: typeof writeSkillRepositoryIdentity
}

export class SkillRepositoryUploadService {
  private readonly account: SkillRepositoryUploadAccountPort
  private readonly publicAppUrl: string
  private readonly openExternal?: (url: string) => Promise<void> | void
  private readonly ensureIdentityWriteAllowed: typeof ensureSkillRepositoryIdentityWriteAllowed
  private readonly readIdentity: typeof readSkillRepositoryIdentity
  private readonly readIdentityRaw: typeof readSkillRepositoryIdentityRaw
  private readonly removeLegacyIdentity: typeof removeLegacySkillRepositoryIdentity
  private readonly writeIdentity: typeof writeSkillRepositoryIdentity

  constructor(deps: SkillRepositoryUploadServiceDeps = {}) {
    this.account = deps.accountService ?? accountService
    this.publicAppUrl = deps.publicAppUrl ?? SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl
    this.openExternal = deps.openExternal
    this.ensureIdentityWriteAllowed = deps.ensureIdentityWriteAllowed ?? ensureSkillRepositoryIdentityWriteAllowed
    this.readIdentity = deps.readIdentity ?? readSkillRepositoryIdentity
    this.readIdentityRaw = deps.readIdentityRaw ?? readSkillRepositoryIdentityRaw
    this.removeLegacyIdentity = deps.removeLegacyIdentity ?? removeLegacySkillRepositoryIdentity
    this.writeIdentity = deps.writeIdentity ?? writeSkillRepositoryIdentity
  }

  async importLocal(
    input: SkillRepositoryLocalImportInput,
    security?: ContentSkillSourceSecurityDeps & SkillRepositoryIdentityWriteSecurity,
  ): Promise<SkillRepositoryLocalImportResult> {
    if (this.account.getState().status !== "authenticated") {
      throw new AccountAuthenticationRequiredError()
    }

    const source = await readSkillDraftFromDirectory(input.sourceDirectoryPath, security, { mode: "publish" })
    if (input.expectedSourceFingerprint && source.sourceFingerprint !== input.expectedSourceFingerprint) {
      throw new Error("本地 Skill 在确认后发生变化，请重新检查发布内容。")
    }
    if (path.basename(source.mainFilePath) !== "SKILL.md") {
      throw new Error("Skill 必须包含根目录 SKILL.md。")
    }

    const { buildSkillRepositoryManagementUrl, normalizeSkillRepositoryName } = await sharedSkillRepositoryPromise
    const name = normalizeSkillRepositoryName(input.name ?? source.metadata.name ?? path.basename(source.sourceDirectoryPath))
    const expectedIdentityRaw = await this.readIdentityRaw(source.sourceDirectoryPath, security)
    const localIdentity = await this.readIdentity(source.sourceDirectoryPath, security)
    await this.ensureIdentityWriteAllowed(source.sourceDirectoryPath, security)
    const localRepositoryId = localIdentity?.id
    const explicitRepositoryId = input.repositoryId ?? undefined
    const importInput: SkillRepositoryImportInput = {
      repositoryId: explicitRepositoryId ?? localRepositoryId ?? undefined,
      name,
      title: input.title ?? source.metadata.title ?? null,
      description: input.description ?? source.metadata.description ?? null,
      files: skillRepositoryImportFiles(source),
    }

    let repository: SkillRepositoryDetailDto
    try {
      repository = await this.account.importSkillRepository(importInput)
    } catch (error) {
      if (explicitRepositoryId || !localRepositoryId || !isNotFoundError(error)) throw error
      repository = await this.account.importSkillRepository({
        ...importInput,
        repositoryId: undefined,
      })
    }
    const owner = repository.owner.handle
    const managementUrl = buildSkillRepositoryManagementUrl(this.publicAppUrl, repository.id)

    let identityWritten = true
    let identityWriteError: string | undefined
    let identityMigrated = false
    let identityMigrationWarning: string | undefined
    try {
      const currentSource = await readSkillDraftFromDirectory(
        source.sourceDirectoryPath,
        security,
        { mode: "publish" },
      )
      if (
        path.basename(currentSource.mainFilePath) !== "SKILL.md"
        || currentSource.sourceFingerprint !== source.sourceFingerprint
      ) {
        throw new Error("本地 Skill 在上传期间发生变化，请重新扫描后再关联。")
      }
      await this.writeIdentity(source.sourceDirectoryPath, {
        id: repository.id,
        kind: "cloud-skill-repository",
        owner,
        name: repository.name,
      }, expectedIdentityRaw, security)
      try {
        const verifiedIdentity = await this.readIdentity(source.sourceDirectoryPath, security)
        if (verifiedIdentity?.id !== repository.id || verifiedIdentity.name !== repository.name) {
          throw new Error("新云仓库身份验证失败，已保留旧身份文件。")
        }
        identityMigrated = await this.removeLegacyIdentity(source.sourceDirectoryPath, security)
      } catch (error) {
        identityMigrationWarning = errorMessage(error)
      }
    } catch (error) {
      identityWritten = false
      identityWriteError = errorMessage(error)
    }

    if (input.openInBrowser === true && this.openExternal) {
      await this.openExternal(managementUrl)
    }

    return {
      repositoryId: repository.id,
      name: repository.name,
      owner,
      managementUrl,
      identityWritten,
      identityMigrated,
      sourceImportSummary: source.sourceImportSummary,
      ...(identityWriteError ? { identityWriteError } : {}),
      ...(!identityWritten ? { identityBeforeUploadId: localIdentity?.id ?? null } : {}),
      ...(identityMigrationWarning ? { identityMigrationWarning } : {}),
    }
  }

  async retryLocalIdentity(
    input: SkillRepositoryLocalIdentityRetryInput,
    security?: ContentSkillSourceSecurityDeps & SkillRepositoryIdentityWriteSecurity,
  ): Promise<SkillRepositoryLocalIdentityRetryResult> {
    if (this.account.getState().status !== "authenticated") {
      throw new AccountAuthenticationRequiredError()
    }

    const source = await readSkillDraftFromDirectory(input.sourceDirectoryPath, security, { mode: "publish" })
    if (source.sourceFingerprint !== input.expectedSourceFingerprint) {
      throw new Error("本地 Skill 在上传后发生变化，请重新检查后再关联。")
    }
    if (path.basename(source.mainFilePath) !== "SKILL.md") {
      throw new Error("Skill 必须包含根目录 SKILL.md。")
    }

    const { normalizeSkillRepositoryName } = await sharedSkillRepositoryPromise
    const identity = {
      id: input.repositoryId.trim(),
      kind: "cloud-skill-repository" as const,
      owner: input.owner?.trim() || null,
      name: normalizeSkillRepositoryName(input.name),
    }
    if (!identity.id) throw new Error("Skill 仓库 ID 不能为空。")

    const expectedIdentityRaw = await this.readIdentityRaw(source.sourceDirectoryPath, security)
    const currentIdentity = await this.readIdentity(source.sourceDirectoryPath, security)
    const currentMatchesTarget = currentIdentity?.id === identity.id
      && currentIdentity.name === identity.name
      && currentIdentity.owner === identity.owner
    if (!currentMatchesTarget && (currentIdentity?.id ?? null) !== input.expectedIdentityId) {
      throw new Error("本地 Skill 的云仓库关联已发生变化，请重新扫描后再试。")
    }

    await this.ensureIdentityWriteAllowed(source.sourceDirectoryPath, security)
    await this.writeIdentity(source.sourceDirectoryPath, identity, expectedIdentityRaw, security)

    let identityMigrated = false
    let identityMigrationWarning: string | undefined
    try {
      const verifiedIdentity = await this.readIdentity(source.sourceDirectoryPath, security)
      if (
        verifiedIdentity?.id !== identity.id
        || verifiedIdentity.name !== identity.name
        || verifiedIdentity.owner !== identity.owner
      ) {
        throw new Error("新云仓库身份验证失败。")
      }
      identityMigrated = await this.removeLegacyIdentity(source.sourceDirectoryPath, security)
    } catch (error) {
      identityMigrationWarning = errorMessage(error)
    }

    return {
      identityWritten: true,
      identityMigrated,
      ...(identityMigrationWarning ? { identityMigrationWarning } : {}),
    }
  }
}

function skillRepositoryImportFiles(source: ContentSkillSourceDraft): SkillRepositoryImportInput["files"] {
  return [
    {
      path: "SKILL.md",
      contentBase64: Buffer.from(source.content, "utf8").toString("base64"),
      mimeType: "text/markdown",
    },
    ...source.files.map((file) => ({
      path: file.originalName,
      contentBase64: Buffer.from(assertSkillFileBytes(file.originalName, file.bytes)).toString("base64"),
      mimeType: null,
    })),
  ]
}

function assertSkillFileBytes(originalName: string, bytes: Uint8Array | undefined): Uint8Array {
  if (!bytes) {
    throw new Error(`无法读取 Skill 附件：${originalName}`)
  }
  return bytes
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "status" in error && error.status === 404)
}

export const skillRepositoryUploadService = new SkillRepositoryUploadService()
