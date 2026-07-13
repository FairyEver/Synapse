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
  readonly identityMigrated: boolean
  readonly identityMigrationWarning?: string
  readonly sourceImportSummary: ContentSkillSourceDraft["sourceImportSummary"]
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
  readonly removeLegacyIdentity?: typeof removeLegacySkillRepositoryIdentity
  readonly writeIdentity?: typeof writeSkillRepositoryIdentity
}

export class SkillRepositoryUploadService {
  private readonly account: SkillRepositoryUploadAccountPort
  private readonly publicAppUrl: string
  private readonly openExternal?: (url: string) => Promise<void> | void
  private readonly ensureIdentityWriteAllowed: typeof ensureSkillRepositoryIdentityWriteAllowed
  private readonly readIdentity: typeof readSkillRepositoryIdentity
  private readonly removeLegacyIdentity: typeof removeLegacySkillRepositoryIdentity
  private readonly writeIdentity: typeof writeSkillRepositoryIdentity

  constructor(deps: SkillRepositoryUploadServiceDeps = {}) {
    this.account = deps.accountService ?? accountService
    this.publicAppUrl = deps.publicAppUrl ?? SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl
    this.openExternal = deps.openExternal
    this.ensureIdentityWriteAllowed = deps.ensureIdentityWriteAllowed ?? ensureSkillRepositoryIdentityWriteAllowed
    this.readIdentity = deps.readIdentity ?? readSkillRepositoryIdentity
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
    const localIdentity = await this.readIdentity(source.sourceDirectoryPath)
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
      await this.writeIdentity(source.sourceDirectoryPath, {
        id: repository.id,
        kind: "cloud-skill-repository",
        owner,
        name: repository.name,
      }, security)
      try {
        const verifiedIdentity = await this.readIdentity(source.sourceDirectoryPath)
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
