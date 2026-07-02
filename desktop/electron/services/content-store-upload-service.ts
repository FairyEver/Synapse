import { createHash } from "node:crypto"
import path from "node:path"

import type {
  EditorScanContentStoreUploadRequest,
  EditorScanContentStoreUploadResult,
} from "../../src/types/editor-scan"
import type { ContentSkillSourceSecurityDeps } from "./content-skill-source-service"
import {
  skillRepositoryUploadService,
  type SkillRepositoryLocalImportInput,
  type SkillRepositoryLocalImportResult,
} from "./skill-repository-upload-service"
import type { SkillRepositoryIdentityWriteSecurity } from "./skill-repository-local-identity"

type SkillRepositoryCompatibilityUploader = {
  readonly importLocal: (
    input: SkillRepositoryLocalImportInput,
    security?: ContentSkillSourceSecurityDeps & SkillRepositoryIdentityWriteSecurity,
  ) => Promise<SkillRepositoryLocalImportResult>
}

type ContentStoreUploadServiceDeps = {
  readonly uploader?: SkillRepositoryCompatibilityUploader
}

type FingerprintInput = Pick<EditorScanContentStoreUploadRequest, "editorId" | "scope" | "projectPath"> & {
  readonly sourceDirectoryPath: string
  readonly platform?: NodeJS.Platform
}

export class ContentStoreUploadService {
  private readonly uploader: SkillRepositoryCompatibilityUploader

  constructor(deps: ContentStoreUploadServiceDeps = {}) {
    this.uploader = deps.uploader ?? skillRepositoryUploadService
  }

  async uploadSkillDraftToContentStore(
    request: EditorScanContentStoreUploadRequest,
    security?: ContentSkillSourceSecurityDeps & SkillRepositoryIdentityWriteSecurity,
  ): Promise<EditorScanContentStoreUploadResult> {
    const result = await this.uploader.importLocal({
      sourceDirectoryPath: request.itemPath,
      name: request.itemName,
      openInBrowser: false,
    }, security)

    return {
      draftId: result.repositoryId,
      itemId: result.repositoryId,
      revision: 1,
      consoleEditUrl: result.managementUrl,
      dashboardEditUrl: result.managementUrl,
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

function buildSkillRepositoryConsoleUrl(publicAppUrl: string, repositoryId: string): string {
  const url = new URL(`/console/skill-repositories/${encodeURIComponent(repositoryId)}`, normalizedUrlBase(publicAppUrl))
  return url.toString()
}

function normalizedUrlBase(publicAppUrl: string): string {
  const trimmed = publicAppUrl.trim()
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`
}

export const contentStoreUploadService = new ContentStoreUploadService()

export {
  buildSkillRepositoryConsoleUrl,
  buildSkillRepositoryConsoleUrl as buildContentStoreConsoleEditUrl,
  buildSkillRepositoryConsoleUrl as buildContentStoreDashboardEditUrl,
  createLocalSourceFingerprint,
  normalizeFingerprintPath,
}
