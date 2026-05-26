import path from "node:path"
import { getContentTypeDefinition } from "../../src/config/content-types"
import type {
  SynapseContentDetail,
  SynapseContentChangedEvent,
  SynapseContentMeta,
  SynapseContentMutationOperation,
  SynapseContentMutationResult,
  SynapseContentType,
  SynapseCreateContentRequest,
  SynapseCreateContentPayload,
  SynapseCreateSkillFilePayload,
  SynapseDeleteContentPayload,
  SynapseUpdateContentRequest,
  SynapseUpdateContentPayload,
} from "../../src/types/content"
import type { EventBus } from "../runtime/event-bus"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"
import { ContentCapabilityError } from "../services/content-capability-errors"
import {
  describeContentTypes,
  normalizeCreateContentParams,
  normalizeDeleteContentParams,
  normalizeUpdateContentParams,
  type ContentToolParams,
} from "../services/content-capability-validator"
import type { ContentIconImageSecurityDeps } from "../services/content-icon-image-service"
import type { ContentSkillSourceDraft } from "../services/content-skill-source-service"

type ContentReaderPort = {
  getDetail(contentType: SynapseContentType, contentId: string): Promise<SynapseContentDetail>
  listContent(contentType: SynapseContentType): Promise<SynapseContentMeta[]>
  listDeletedContent(contentType: SynapseContentType): Promise<SynapseContentMeta[]>
}

type ContentWriterPort = {
  createContent(request: SynapseCreateContentRequest): Promise<SynapseContentMutationResult>
  deleteContent(payload: SynapseDeleteContentPayload): Promise<SynapseContentMutationResult>
  updateContent(request: SynapseUpdateContentRequest): Promise<SynapseContentMutationResult>
}

type ContentIdentity = {
  userId: string
}

type ContentCapabilityDispatcherDeps = {
  contentReader: ContentReaderPort
  contentWriter: ContentWriterPort
  eventBus?: Pick<EventBus, "emit">
  prepareIconImageBytes: (
    input: ContentToolParams,
    security?: ContentIconImageSecurityDeps,
  ) => Promise<Uint8Array | undefined>
  readSkillDraftFromDirectory: (
    sourceDirectoryPath: string,
    security?: ContentIconImageSecurityDeps,
  ) => Promise<ContentSkillSourceDraft>
  resolveCurrentIdentity: () => Promise<ContentIdentity>
  security?: ContentIconImageSecurityDeps
}

type ParsedContentAction = {
  operation: "list" | "get" | "create" | "update" | "delete"
  type: SynapseContentType
}

type SkillSourceMergeResult = {
  params: ContentToolParams
  sourceFiles?: SynapseCreateSkillFilePayload[]
}

const CONTENT_ACTION_PATTERN = /^content\.(rule|skill|prompt)\.(list|get|create|update|delete)$/u
const AUTO_DESCRIPTION_MAX_LENGTH = 120

function createContentCapabilityDispatcher(deps: ContentCapabilityDispatcherDeps) {
  return {
    async dispatch(action: string, params: ContentToolParams, _context: DispatchContext): Promise<DispatchResult> {
      if (action === "content.type.describe") {
        return { ok: true, data: describeContentTypes(params.contentType) }
      }

      const parsed = parseContentAction(action)
      switch (parsed.operation) {
        case "list":
          return listContent(deps, parsed.type, params)
        case "get":
          return getContent(deps, parsed.type, params)
        case "create":
          return createContent(deps, parsed.type, params)
        case "update":
          return updateContent(deps, parsed.type, params)
        case "delete":
          return deleteContent(deps, parsed.type, params)
      }
    },
  }
}

async function listContent(
  deps: ContentCapabilityDispatcherDeps,
  contentType: SynapseContentType,
  params: ContentToolParams,
): Promise<DispatchResult> {
  const active = await deps.contentReader.listContent(contentType)
  const deleted = params.includeDeleted === true
    ? await deps.contentReader.listDeletedContent(contentType)
    : []
  const data = [...active, ...deleted]

  return { ok: true, data, total: data.length }
}

async function getContent(
  deps: ContentCapabilityDispatcherDeps,
  contentType: SynapseContentType,
  params: ContentToolParams,
): Promise<DispatchResult> {
  const id = requireTrimmedString(params.id, "id")
  return { ok: true, data: await deps.contentReader.getDetail(contentType, id) }
}

async function createContent(
  deps: ContentCapabilityDispatcherDeps,
  contentType: SynapseContentType,
  params: ContentToolParams,
): Promise<DispatchResult> {
  const merged = await mergeSkillSourceParams(deps, contentType, params)
  const payload = normalizeCreateContentParams(contentType, merged.params)

  if (contentType === "skill" && merged.sourceFiles) {
    const skillPayload = payload as SynapseCreateContentPayload<"skill">
    skillPayload.files = merged.sourceFiles
  }
  await applyIconImageBytes(deps, payload, merged.params)

  const result = await deps.contentWriter.createContent({
    contentType,
    payload,
  } as SynapseCreateContentRequest)
  emitContentChanged(deps, "create", result)

  return { ok: true, data: result }
}

async function updateContent(
  deps: ContentCapabilityDispatcherDeps,
  contentType: SynapseContentType,
  params: ContentToolParams,
): Promise<DispatchResult> {
  const id = requireTrimmedString(params.id, "id")
  await assertOwnedByCurrentUser(deps, contentType, id)

  const merged = await mergeSkillSourceParams(deps, contentType, params)
  const payload = normalizeUpdateContentParams(contentType, merged.params)

  if (contentType === "skill" && merged.sourceFiles) {
    const skillPayload = payload as SynapseUpdateContentPayload<"skill">
    skillPayload.files = merged.sourceFiles
  }
  await applyIconImageBytes(deps, payload, merged.params)

  const result = await deps.contentWriter.updateContent({
    contentType,
    payload,
  } as SynapseUpdateContentRequest)
  assertNoMutationConflict(result)
  emitContentChanged(deps, "update", result)

  return { ok: true, data: result }
}

async function deleteContent(
  deps: ContentCapabilityDispatcherDeps,
  contentType: SynapseContentType,
  params: ContentToolParams,
): Promise<DispatchResult> {
  const payload = normalizeDeleteContentParams(contentType, params)
  await assertOwnedByCurrentUser(deps, contentType, payload.id)

  const result = await deps.contentWriter.deleteContent(payload)
  assertNoMutationConflict(result)
  emitContentChanged(deps, "delete", result)

  return {
    ok: true,
    data: result,
  }
}

function assertNoMutationConflict(result: SynapseContentMutationResult): void {
  if (result.status !== "conflict") {
    return
  }

  throw new ContentCapabilityError("CONTENT_CONFLICT", "内容已更新，请先读取最新版本后重试。", {
    details: {
      conflict: result,
    },
  })
}

function emitContentChanged(
  deps: ContentCapabilityDispatcherDeps,
  operation: SynapseContentMutationOperation,
  result: SynapseContentMutationResult,
): void {
  if (result.status !== "saved") {
    return
  }

  const payload: SynapseContentChangedEvent = {
    contentType: result.type,
    contentId: result.id,
    operation,
    latestHistoryDirname: result.latestHistoryDirname,
    modifiedAt: result.modifiedAt,
  }

  deps.eventBus?.emit({
    domain: "content",
    type: "content.changed",
    payload,
    timestamp: new Date().toISOString(),
  }, { backpressure: "block" })
}

async function mergeSkillSourceParams(
  deps: ContentCapabilityDispatcherDeps,
  contentType: SynapseContentType,
  params: ContentToolParams,
): Promise<SkillSourceMergeResult> {
  if (contentType !== "skill") {
    return { params }
  }

  const sourceDirectoryPath = optionalTrimmedString(params.sourceDirectoryPath)
  if (!sourceDirectoryPath) {
    return { params }
  }

  if (Array.isArray(params.files) && params.files.length > 0) {
    return { params }
  }

  const sourceDraft = await deps.readSkillDraftFromDirectory(sourceDirectoryPath, deps.security)
  const parsed = parseFrontmatter(sourceDraft.content)
  const metadata = sourceDraft.metadata
  const fallbackName = path.basename(sourceDirectoryPath)
  const title = pickString(params.title, metadata.title, extractHeadingTitle(parsed.body), fallbackName)

  return {
    params: {
      ...params,
      name: pickString(params.name, metadata.name, toContentName(fallbackName, "skill")),
      title,
      description: pickString(
        params.description,
        metadata.description,
        shortenAutoDescription(extractFirstParagraph(parsed.body)),
        title,
      ),
      category: pickString(params.category, metadata.category, defaultCategoryFor("skill")),
      content: pickString(params.content, parsed.body),
    },
    sourceFiles: sourceDraft.files,
  }
}

async function applyIconImageBytes(
  deps: ContentCapabilityDispatcherDeps,
  payload: { iconImageBytes?: Uint8Array; iconType?: string },
  params: ContentToolParams,
): Promise<void> {
  if (payload.iconType !== "image") {
    return
  }

  const iconImageBytes = await deps.prepareIconImageBytes(params, deps.security)
  if (!iconImageBytes) {
    throw new ContentCapabilityError("CONTENT_INVALID_INPUT", "使用图片背景时必须提供图片。", {
      fields: { iconImage: "使用图片背景时必须提供图片。" },
    })
  }

  payload.iconImageBytes = iconImageBytes
}

async function assertOwnedByCurrentUser(
  deps: ContentCapabilityDispatcherDeps,
  contentType: SynapseContentType,
  contentId: string,
): Promise<void> {
  const [identity, detail] = await Promise.all([
    deps.resolveCurrentIdentity(),
    deps.contentReader.getDetail(contentType, contentId),
  ])

  if (detail.createdBy !== identity.userId) {
    throw new ContentCapabilityError("CONTENT_FORBIDDEN", "只能更新或删除自己发布的资源。", {
      details: {
        contentId,
        contentType,
      },
    })
  }
}

function parseContentAction(action: string): ParsedContentAction {
  const match = CONTENT_ACTION_PATTERN.exec(action)
  if (!match) {
    throw new Error(`Unknown content action: ${action}`)
  }

  return {
    type: match[1] as SynapseContentType,
    operation: match[2] as ParsedContentAction["operation"],
  }
}

function parseFrontmatter(text: string): { metadata: Record<string, string>; body: string } {
  if (!text.startsWith("---")) return { metadata: {}, body: text.trim() }

  const endIndex = text.indexOf("\n---", 3)
  if (endIndex === -1) return { metadata: {}, body: text.trim() }

  return {
    metadata: {},
    body: text.slice(endIndex + 4).trim(),
  }
}

function extractHeadingTitle(content: string): string {
  const heading = content.split("\n").find((line) => line.trim().startsWith("# "))
  return heading ? heading.replace(/^#\s*/u, "").trim() : ""
}

function extractFirstParagraph(content: string): string {
  const paragraph: string[] = []

  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      if (paragraph.length > 0) break
      continue
    }
    paragraph.push(trimmed)
  }

  return paragraph.join(" ").trim()
}

function shortenAutoDescription(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= AUTO_DESCRIPTION_MAX_LENGTH) {
    return trimmed
  }

  return `${trimmed.slice(0, AUTO_DESCRIPTION_MAX_LENGTH - 1).trimEnd()}.`
}

function toContentName(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64)
    .replace(/-+$/u, "")

  return normalized || fallback
}

function defaultCategoryFor(contentType: SynapseContentType): string {
  return getContentTypeDefinition(contentType).categories[0]?.id ?? ""
}

function requireTrimmedString(value: unknown, field: string): string {
  const text = optionalTrimmedString(value)
  if (!text) {
    throw new ContentCapabilityError("CONTENT_INVALID_INPUT", `${field} 不能为空。`, {
      fields: { [field]: `${field} 不能为空。` },
    })
  }
  return text
}

function optionalTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    const text = optionalTrimmedString(value)
    if (text) return text
  }
  return ""
}

export {
  createContentCapabilityDispatcher,
  type ContentCapabilityDispatcherDeps,
  type ContentReaderPort,
  type ContentWriterPort,
}
