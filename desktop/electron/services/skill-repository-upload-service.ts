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
  readSkillRepositoryIdentity,
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
  readonly openInBrowser?: boolean
}

export type SkillRepositoryLocalImportResult = {
  readonly repositoryId: string
  readonly name: string
  readonly owner: string | null
  readonly managementUrl: string
}

type SkillRepositoryUploadAccountPort = {
  readonly getState: () => SynapseAccountState
  readonly importSkillRepository: (input: SkillRepositoryImportInput) => Promise<SkillRepositoryDetailDto>
}

type SkillRepositoryUploadServiceDeps = {
  readonly accountService?: SkillRepositoryUploadAccountPort
  readonly publicAppUrl?: string
  readonly openExternal?: (url: string) => Promise<void> | void
  readonly readIdentity?: typeof readSkillRepositoryIdentity
  readonly writeIdentity?: typeof writeSkillRepositoryIdentity
}

export class SkillRepositoryUploadService {
  private readonly account: SkillRepositoryUploadAccountPort
  private readonly publicAppUrl: string
  private readonly openExternal?: (url: string) => Promise<void> | void
  private readonly readIdentity: typeof readSkillRepositoryIdentity
  private readonly writeIdentity: typeof writeSkillRepositoryIdentity

  constructor(deps: SkillRepositoryUploadServiceDeps = {}) {
    this.account = deps.accountService ?? accountService
    this.publicAppUrl = deps.publicAppUrl ?? SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl
    this.openExternal = deps.openExternal
    this.readIdentity = deps.readIdentity ?? readSkillRepositoryIdentity
    this.writeIdentity = deps.writeIdentity ?? writeSkillRepositoryIdentity
  }

  async importLocal(
    input: SkillRepositoryLocalImportInput,
    security?: ContentSkillSourceSecurityDeps & SkillRepositoryIdentityWriteSecurity,
  ): Promise<SkillRepositoryLocalImportResult> {
    if (this.account.getState().status !== "authenticated") {
      throw new AccountAuthenticationRequiredError()
    }

    const source = await readSkillDraftFromDirectory(input.sourceDirectoryPath, security)
    if (path.basename(source.mainFilePath) !== "SKILL.md") {
      throw new Error("Skill 必须包含根目录 SKILL.md。")
    }

    const { buildSkillRepositoryManagementUrl, normalizeSkillRepositoryName } = await sharedSkillRepositoryPromise
    const name = normalizeSkillRepositoryName(input.name ?? source.metadata.name ?? path.basename(source.sourceDirectoryPath))
    const localIdentity = await this.readIdentity(source.sourceDirectoryPath)
    const repository = await this.account.importSkillRepository({
      repositoryId: input.repositoryId ?? localIdentity?.id ?? undefined,
      name,
      title: input.title ?? source.metadata.title ?? null,
      description: input.description ?? source.metadata.description ?? null,
      files: skillRepositoryImportFiles(source),
    })
    const owner = repository.owner.handle
    const managementUrl = buildSkillRepositoryManagementUrl(this.publicAppUrl, repository.id)

    await this.writeIdentity(source.sourceDirectoryPath, {
      id: repository.id,
      kind: "cloud-skill-repository",
      owner,
      name: repository.name,
    }, security)

    if (input.openInBrowser === true && this.openExternal) {
      await this.openExternal(managementUrl)
    }

    return {
      repositoryId: repository.id,
      name: repository.name,
      owner,
      managementUrl,
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

export const skillRepositoryUploadService = new SkillRepositoryUploadService()
