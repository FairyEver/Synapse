import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  SynapseContentAttachmentRecord,
  SynapseContentDetail,
  SynapseContentHistoryEntry,
  SynapseContentHistoryVersion,
  SynapseContentMeta,
  SynapseContentType,
  SynapseTextContentFile,
} from "../../src/types/content"
import {
  readRepositorySeedContents,
  type RepositorySeedAttachment,
  type RepositorySeedContent,
} from "./repository-template-service"

const BUILTIN_CONTENT_ID_PREFIX = "builtin"
const BUILTIN_HISTORY_DIRNAME = "builtin-current"
const BUILTIN_AUTHOR_ID = "synapse"
const BUILTIN_AUTHOR_NAME = "Synapse"
const BUILTIN_TIMESTAMP = "1970-01-01T00:00:00.000Z"

type BuiltinContentIdParts = {
  rawId: string
  type: SynapseContentType
}

type BuiltinContentRecord = RepositorySeedContent & {
  builtinId: string
  attachmentRecords: SynapseContentAttachmentRecord[]
}

function createBuiltinContentId(type: SynapseContentType, rawId: string): string {
  return `${BUILTIN_CONTENT_ID_PREFIX}:${type}:${rawId}`
}

function parseBuiltinContentId(contentId: string): BuiltinContentIdParts | null {
  const [prefix, rawType, ...rawIdParts] = contentId.split(":")

  if (
    prefix !== BUILTIN_CONTENT_ID_PREFIX
    || (rawType !== "rule" && rawType !== "skill" && rawType !== "prompt")
    || rawIdParts.length === 0
  ) {
    return null
  }

  const rawId = rawIdParts.join(":")

  return rawId ? { type: rawType, rawId } : null
}

function isBuiltinContentId(contentId: string): boolean {
  return parseBuiltinContentId(contentId) !== null
}

function hashAttachment(attachment: RepositorySeedAttachment): SynapseContentAttachmentRecord {
  return {
    originalName: attachment.originalName,
    sha256: createHash("sha256").update(attachment.bytes).digest("hex"),
    size: attachment.bytes.byteLength,
  }
}

function createTextFile(relativePath: string, content: string): SynapseTextContentFile {
  return {
    relativePath,
    name: path.basename(relativePath),
    size: Buffer.byteLength(content),
    kind: "text",
    content,
  }
}

function toMeta(seed: BuiltinContentRecord): SynapseContentMeta {
  return {
    id: seed.builtinId,
    type: seed.type,
    title: seed.title,
    ...(seed.name ? { name: seed.name } : {}),
    description: seed.description,
    category: "builtin",
    icon: seed.icon,
    iconBg: seed.iconBg,
    iconType: "icon",
    createdBy: BUILTIN_AUTHOR_ID,
    createdByDisplayName: BUILTIN_AUTHOR_NAME,
    createdAt: BUILTIN_TIMESTAMP,
    modifiedBy: BUILTIN_AUTHOR_ID,
    modifiedByDisplayName: BUILTIN_AUTHOR_NAME,
    modifiedAt: BUILTIN_TIMESTAMP,
    deleted: false,
    latestHistoryDirname: BUILTIN_HISTORY_DIRNAME,
    attachmentCount: seed.attachmentRecords.length,
    source: "builtin",
    isReadonly: true,
  } as SynapseContentMeta
}

function toDetail(seed: BuiltinContentRecord): SynapseContentDetail {
  return {
    ...toMeta(seed),
    content: seed.content,
    attachments: seed.attachmentRecords,
  } as SynapseContentDetail
}

class BuiltinContentService {
  private cache: Promise<BuiltinContentRecord[]> | null = null

  isBuiltinContentId(contentId: string): boolean {
    return isBuiltinContentId(contentId)
  }

  parseBuiltinContentId(contentId: string): BuiltinContentIdParts | null {
    return parseBuiltinContentId(contentId)
  }

  async listContent<T extends SynapseContentType>(contentType: T): Promise<SynapseContentMeta<T>[]> {
    const records = await this.readRecords()

    return records
      .filter((record) => record.type === contentType)
      .map((record) => toMeta(record) as SynapseContentMeta<T>)
  }

  async getContent(contentType: SynapseContentType, contentId: string): Promise<SynapseTextContentFile> {
    const detail = await this.getDetail(contentType, contentId)

    return createTextFile("main.md", detail.content)
  }

  async getDetail(contentType: SynapseContentType, contentId: string): Promise<SynapseContentDetail> {
    const record = await this.getRecord(contentType, contentId)

    return toDetail(record)
  }

  async getHistory(contentType: SynapseContentType, contentId: string): Promise<SynapseContentHistoryEntry[]> {
    const detail = await this.getDetail(contentType, contentId)

    return [{
      dirname: detail.latestHistoryDirname,
      modifiedAt: detail.modifiedAt,
      modifiedBy: detail.modifiedBy,
      modifiedByDisplayName: detail.modifiedByDisplayName,
      deleted: false,
      isCurrent: true,
    }]
  }

  async getHistoryVersion(
    contentType: SynapseContentType,
    contentId: string,
    historyDirname: string,
  ): Promise<SynapseContentHistoryVersion> {
    if (historyDirname !== BUILTIN_HISTORY_DIRNAME) {
      throw new Error("这条历史记录已不可用。")
    }

    return {
      ...await this.getDetail(contentType, contentId),
      historyDirname,
      isCurrent: true,
    } as SynapseContentHistoryVersion
  }

  async copyAttachmentToPath(
    contentType: SynapseContentType,
    contentId: string,
    attachment: SynapseContentAttachmentRecord,
    targetPath: string,
  ): Promise<void> {
    const record = await this.getRecord(contentType, contentId)
    const sourceAttachment = record.attachments?.find((candidate) => (
      candidate.originalName === attachment.originalName
      && createHash("sha256").update(candidate.bytes).digest("hex") === attachment.sha256
    ))

    if (!sourceAttachment) {
      throw new Error(`找不到内置附件：${attachment.originalName}`)
    }

    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, sourceAttachment.bytes)
  }

  private async readRecords(): Promise<BuiltinContentRecord[]> {
    if (!this.cache) {
      this.cache = readRepositorySeedContents().then((seeds) => (
        seeds.map((seed) => ({
          ...seed,
          builtinId: createBuiltinContentId(seed.type, seed.id),
          attachmentRecords: (seed.attachments ?? []).map(hashAttachment),
        }))
      ))
    }

    return this.cache
  }

  private async getRecord(
    contentType: SynapseContentType,
    contentId: string,
  ): Promise<BuiltinContentRecord> {
    const parsed = parseBuiltinContentId(contentId)

    if (!parsed || parsed.type !== contentType) {
      throw new Error("找不到对应的内置资源。")
    }

    const records = await this.readRecords()
    const record = records.find((candidate) => (
      candidate.type === contentType && candidate.id === parsed.rawId
    ))

    if (!record) {
      throw new Error("找不到对应的内置资源。")
    }

    return record
  }
}

const builtinContentService = new BuiltinContentService()

export {
  BUILTIN_HISTORY_DIRNAME,
  builtinContentService,
  createBuiltinContentId,
  isBuiltinContentId,
  parseBuiltinContentId,
}
