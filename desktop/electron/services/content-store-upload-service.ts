import { createHash } from "node:crypto"
import path from "node:path"

import type { ContentStoreDraftDto } from "@synapse/shared" with { "resolution-mode": "import" }
import type {
  EditorScanContentStoreUploadRequest,
  EditorScanContentStoreUploadResult,
} from "../../src/types/editor-scan"
import type { SynapseAccountState } from "../../src/types/account"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../generated/deployment-config.generated"
import type { ContentSkillSourceSecurityDeps } from "./content-skill-source-service"
import { readSkillDraftFromDirectory } from "./content-skill-source-service"
import { AccountAuthenticationRequiredError, accountService } from "./account-service"

type ContentStoreUploadAccountPort = {
  readonly getState: () => SynapseAccountState
  readonly createContentStoreSkillDraft: (input: {
    readonly type: "skill"
    readonly title: string
    readonly description?: string | null
    readonly localSourceFingerprint: string
    readonly files: Array<{
      readonly path: string
      readonly contentBase64: string
      readonly mimeType?: string | null
    }>
  }) => Promise<ContentStoreDraftDto>
}

type ContentStoreUploadServiceDeps = {
  readonly accountService?: ContentStoreUploadAccountPort
  readonly publicAppUrl?: string
}

type FingerprintInput = Pick<EditorScanContentStoreUploadRequest, "editorId" | "scope" | "projectPath"> & {
  readonly sourceDirectoryPath: string
  readonly platform?: NodeJS.Platform
}

export class ContentStoreUploadService {
  private readonly account: ContentStoreUploadAccountPort
  private readonly publicAppUrl: string

  constructor(deps: ContentStoreUploadServiceDeps = {}) {
    this.account = deps.accountService ?? accountService
    this.publicAppUrl = deps.publicAppUrl ?? SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl
  }

  async uploadSkillDraftToContentStore(
    request: EditorScanContentStoreUploadRequest,
    security?: ContentSkillSourceSecurityDeps,
  ): Promise<EditorScanContentStoreUploadResult> {
    if (this.account.getState().status !== "authenticated") {
      throw new AccountAuthenticationRequiredError()
    }

    const sourceDraft = await readSkillDraftFromDirectory(request.itemPath, security)
    if (path.basename(sourceDraft.mainFilePath) !== "SKILL.md") {
      throw new Error("Skill 必须包含根目录 SKILL.md。")
    }

    const localSourceFingerprint = createLocalSourceFingerprint({
      editorId: request.editorId,
      scope: request.scope,
      projectPath: request.projectPath ?? null,
      sourceDirectoryPath: sourceDraft.sourceDirectoryPath,
    })
    const draft = await this.account.createContentStoreSkillDraft({
      type: "skill",
      title: skillDraftTitle(sourceDraft.metadata, sourceDraft.content, request.itemName),
      description: skillDraftDescription(sourceDraft.metadata),
      localSourceFingerprint,
      files: [
        {
          path: "SKILL.md",
          contentBase64: Buffer.from(sourceDraft.content, "utf8").toString("base64"),
          mimeType: "text/markdown",
        },
        ...sourceDraft.files.map((file) => ({
          path: file.originalName,
          contentBase64: Buffer.from(assertSkillFileBytes(file.originalName, file.bytes)).toString("base64"),
          mimeType: null,
        })),
      ],
    })

    const consoleEditUrl = buildContentStoreConsoleEditUrl(this.publicAppUrl, draft.itemId)
    return {
      draftId: draft.id,
      itemId: draft.itemId,
      revision: draft.revision,
      consoleEditUrl,
      dashboardEditUrl: consoleEditUrl,
    }
  }
}

function createLocalSourceFingerprint(input: FingerprintInput): string {
  const platform = input.platform ?? process.platform
  const tuple = {
    version: 1,
    editorId: input.editorId.trim(),
    scope: input.scope,
    projectPath: normalizeFingerprintPath(input.projectPath ?? null, platform),
    sourceDirectoryPath: normalizeFingerprintPath(input.sourceDirectoryPath, platform),
  }
  return createHash("sha256").update(JSON.stringify(tuple)).digest("hex")
}

function normalizeFingerprintPath(value: string | null, platform: NodeJS.Platform = process.platform): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const pathModule = platform === "win32" ? path.win32 : path
  const resolved = pathModule.resolve(trimmed)
  const portable = resolved.split(pathModule.sep).join("/")
  return platform === "win32" ? portable.toLowerCase() : portable
}

function buildContentStoreConsoleEditUrl(publicAppUrl: string, itemId: string): string {
  const url = new URL(`/console/my-content/${encodeURIComponent(itemId)}/edit`, normalizedUrlBase(publicAppUrl))
  return url.toString()
}

function normalizedUrlBase(publicAppUrl: string): string {
  const trimmed = publicAppUrl.trim()
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`
}

function skillDraftTitle(metadata: Record<string, string>, content: string, fallback: string): string {
  return (
    metadata.title?.trim()
    || metadata.name?.trim()
    || extractHeadingTitle(content)
    || fallback.trim()
    || "Skill"
  ).slice(0, 160)
}

function skillDraftDescription(metadata: Record<string, string>): string | null {
  const description = metadata.description?.trim()
  return description ? description.slice(0, 2000) : null
}

function extractHeadingTitle(content: string): string | null {
  const heading = content.split("\n").find((line) => line.trim().startsWith("# "))
  return heading ? heading.replace(/^#\s*/, "").trim() || null : null
}

function assertSkillFileBytes(originalName: string, bytes: Uint8Array | undefined): Uint8Array {
  if (!bytes) {
    throw new Error(`无法读取 Skill 附件：${originalName}`)
  }
  return bytes
}

export const contentStoreUploadService = new ContentStoreUploadService()

export {
  buildContentStoreConsoleEditUrl,
  buildContentStoreConsoleEditUrl as buildContentStoreDashboardEditUrl,
  createLocalSourceFingerprint,
  normalizeFingerprintPath,
}
