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
import { isContentCreator } from "../../src/lib/content-ownership"
import type { EventBus } from "../runtime/event-bus"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"
import { ContentCapabilityError } from "../services/content-capability-errors"
import { sanitizeError } from "../services/error-sanitize"
import { createMainLogger } from "../services/log-store"
import { checkCapabilityPermission } from "./permission-audit"
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
    options?: { mode?: "install" | "publish" },
  ) => Promise<ContentSkillSourceDraft>
  resolveCurrentIdentity: () => Promise<ContentIdentity>
  security?: ContentIconImageSecurityDeps
}

type ParsedContentAction = {
  operation: "list" | "get" | "create" | "update" | "delete"
  type: SynapseContentType
}
type ReadContentOperation = Extract<ParsedContentAction["operation"], "list" | "get">
type MutatingContentOperation = Extract<ParsedContentAction["operation"], "create" | "update" | "delete">

type SkillSourceMergeResult = {
  params: ContentToolParams
  sourceFiles?: SynapseCreateSkillFilePayload[]
  sourceImportSummary?: ContentSkillSourceDraft["sourceImportSummary"]
}

const CONTENT_ACTION_PATTERN = /^app\.resource_repository\.(rule|skill|prompt)\.(list|get|create|update|delete)$/u
const AUTO_DESCRIPTION_MAX_LENGTH = 120
const logger = createMainLogger("capability.content-dispatcher")

function createContentCapabilityDispatcher(deps: ContentCapabilityDispatcherDeps) {
  return {
    async dispatch(action: string, params: ContentToolParams, context: DispatchContext): Promise<DispatchResult> {
      if (action === "app.resource_repository.type.describe") {
        return { ok: true, data: describeContentTypes(params.contentType) }
      }

      const parsed = parseContentAction(action)
      switch (parsed.operation) {
        case "list":
          return dispatchContentRead(deps, parsed.type, parsed.operation, action, params, context, () => listContent(deps, parsed.type, params))
        case "get":
          return dispatchContentRead(deps, parsed.type, parsed.operation, action, params, context, () => getContent(deps, parsed.type, params))
        case "create":
          return dispatchContentMutation(deps, parsed.type, parsed.operation, action, params, context, (security) => createContent(deps, parsed.type, params, security))
        case "update":
          return dispatchContentMutation(deps, parsed.type, parsed.operation, action, params, context, (security) => updateContent(deps, parsed.type, params, security))
        case "delete":
          return dispatchContentMutation(deps, parsed.type, parsed.operation, action, params, context, () => deleteContent(deps, parsed.type, params))
      }
    },
  }
}

async function dispatchContentRead(
  deps: ContentCapabilityDispatcherDeps,
  contentType: SynapseContentType,
  operation: ReadContentOperation,
  action: string,
  params: ContentToolParams,
  context: DispatchContext,
  task: () => Promise<DispatchResult>,
): Promise<DispatchResult> {
  const security = buildContentReadSecurity(deps.security, contentType, operation, action, params, context)
  if (security) {
    try {
      await authorizeContentRead(security)
    } catch (error) {
      logger.warn("content capability read dispatch failed", {
        ...security.metadata,
        ...dispatchErrorDiagnostic(error),
      })
      throw error
    }
  }

  try {
    const result = await task()
    security?.deps.auditSink.record({
      action: "content.read",
      actor: security.deps.actor,
      resource: security.resource,
      outcome: "allowed",
      metadata: {
        ...security.metadata,
        ...contentReadResultCorrelation(result),
      },
    })
    return result
  } catch (error) {
    security?.deps.auditSink.record({
      action: "content.read",
      actor: security.deps.actor,
      resource: security.resource,
      outcome: "failed",
      metadata: {
        ...security.metadata,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      },
    })
    throw error
  }
}

async function dispatchContentMutation(
  deps: ContentCapabilityDispatcherDeps,
  contentType: SynapseContentType,
  operation: MutatingContentOperation,
  action: string,
  params: ContentToolParams,
  context: DispatchContext,
  task: (security?: ContentIconImageSecurityDeps) => Promise<DispatchResult>,
): Promise<DispatchResult> {
  const logMeta = contentDispatchCorrelation(contentType, operation, action, params, context)
  logger.info("content capability dispatch", logMeta)
  const security = buildContentMutationSecurity(deps.security, contentType, operation, action, params, context)
  if (security) {
    try {
      await authorizeContentMutation(security)
    } catch (error) {
      logger.warn("content capability dispatch failed", {
        ...logMeta,
        ...dispatchErrorDiagnostic(error),
      })
      throw error
    }
  }

  try {
    const result = await task(security?.deps)
    security?.deps.auditSink.record({
      action: "content.mutate",
      actor: security.deps.actor,
      resource: security.resource,
      outcome: "allowed",
      metadata: security.metadata,
    })
    logger.info("content capability dispatch succeeded", {
      ...logMeta,
      ...dispatchResultCorrelation(result),
    })
    return result
  } catch (error) {
    security?.deps.auditSink.record({
      action: "content.mutate",
      actor: security.deps.actor,
      resource: security.resource,
      outcome: "failed",
      metadata: {
        ...security.metadata,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      },
    })
    logger.warn("content capability dispatch failed", {
      ...logMeta,
      ...dispatchErrorDiagnostic(error),
    })
    throw error
  }
}

function contentDispatchCorrelation(
  contentType: SynapseContentType,
  operation: MutatingContentOperation,
  action: string,
  params: ContentToolParams,
  context: DispatchContext,
): Record<string, unknown> {
  const contentId = optionalTrimmedString(params.id)
  const baseHistoryDirname = optionalTrimmedString(params.baseHistoryDirname)
  const hasIconImageInput = Boolean(optionalTrimmedString(params.iconImagePath) || optionalTrimmedString(params.iconImageBase64))
  return {
    action,
    contentType,
    operation,
    source: context.source ?? "api",
    ...(contentId ? { contentId } : {}),
    ...(baseHistoryDirname ? { baseHistoryDirname } : {}),
    hasContent: typeof params.content === "string" && params.content.length > 0,
    hasFiles: Array.isArray(params.files) && params.files.length > 0,
    hasIconImageInput,
    hasSourceDirectoryPath: Boolean(optionalTrimmedString(params.sourceDirectoryPath)),
  }
}

function dispatchResultCorrelation(result: DispatchResult): Record<string, unknown> {
  const data = result.data
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {}
  }
  const record = data as Record<string, unknown>
  return {
    ...(typeof record.id === "string" ? { resultContentId: record.id } : {}),
    ...(typeof record.status === "string" ? { resultStatus: record.status } : {}),
    ...(typeof record.type === "string" ? { resultContentType: record.type } : {}),
  }
}

function contentReadResultCorrelation(result: DispatchResult): Record<string, unknown> {
  return result.ok && typeof result.total === "number" ? { resultCount: result.total } : {}
}

function dispatchErrorDiagnostic(error: unknown): {
  readonly errorName: string
  readonly errorMessage: string
} {
  const message = error instanceof Error ? error.message : String(error)
  const sanitized = sanitizeError(message)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: sanitized.length <= 200 ? sanitized : `${sanitized.slice(0, 200)}...`,
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
  security?: ContentIconImageSecurityDeps,
): Promise<DispatchResult> {
  const merged = await mergeSkillSourceParams(deps, contentType, params, undefined, security)
  const payload = normalizeCreateContentParams(contentType, merged.params)

  if (contentType === "skill" && merged.sourceFiles) {
    const skillPayload = payload as SynapseCreateContentPayload<"skill">
    skillPayload.files = merged.sourceFiles
  }
  await applyIconImageBytes(deps, payload, merged.params, security)

  const result = await deps.contentWriter.createContent({
    contentType,
    payload,
  } as SynapseCreateContentRequest)
  emitContentChanged(deps, "create", result)

  return {
    ok: true,
    data: merged.sourceImportSummary ? { ...result, sourceImportSummary: merged.sourceImportSummary } : result,
  }
}

async function updateContent(
  deps: ContentCapabilityDispatcherDeps,
  contentType: SynapseContentType,
  params: ContentToolParams,
  security?: ContentIconImageSecurityDeps,
): Promise<DispatchResult> {
  const id = requireTrimmedString(params.id, "id")
  const currentDetail = contentType === "skill"
    ? await deps.contentReader.getDetail(contentType, id)
    : await assertOwnedByCurrentUser(deps, contentType, id)

  const merged = await mergeSkillSourceParams(deps, contentType, params, currentDetail, security)
  const payload = normalizeUpdateContentParams(contentType, merged.params)

  if (contentType === "skill" && merged.sourceFiles) {
    const skillPayload = payload as SynapseUpdateContentPayload<"skill">
    skillPayload.files = merged.sourceFiles
  }
  await applyIconImageBytes(deps, payload, merged.params, security)

  const result = await deps.contentWriter.updateContent({
    contentType,
    payload,
  } as SynapseUpdateContentRequest)
  assertNoMutationConflict(result)
  emitContentChanged(deps, "update", result)

  return {
    ok: true,
    data: merged.sourceImportSummary ? { ...result, sourceImportSummary: merged.sourceImportSummary } : result,
  }
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
  currentDetail?: SynapseContentDetail,
  security?: ContentIconImageSecurityDeps,
): Promise<SkillSourceMergeResult> {
  if (contentType !== "skill") {
    return { params }
  }

  const sourceDirectoryPath = optionalNonBlankString(params.sourceDirectoryPath)
  if (!sourceDirectoryPath) {
    return { params }
  }

  if (Array.isArray(params.files) && params.files.length > 0) {
    return { params }
  }

  const sourceDraft = await deps.readSkillDraftFromDirectory(
    sourceDirectoryPath,
    security ?? deps.security,
    { mode: "publish" },
  )
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
      ...mergeExistingAppearanceParams(params, currentDetail),
    },
    sourceFiles: sourceDraft.files,
    sourceImportSummary: sourceDraft.sourceImportSummary,
  }
}

function mergeExistingAppearanceParams(
  params: ContentToolParams,
  currentDetail: SynapseContentDetail | undefined,
): ContentToolParams {
  if (!currentDetail) {
    return {}
  }

  const iconType = optionalTrimmedString(params.iconType)
  const hasImageInput = Boolean(optionalTrimmedString(params.iconImagePath) || optionalTrimmedString(params.iconImageBase64))
  const hasBuiltInInput = Boolean(optionalTrimmedString(params.icon) || optionalTrimmedString(params.iconBg))
  if (hasImageInput || hasBuiltInInput || iconType === "icon") {
    return {}
  }
  if (iconType && iconType !== "image") {
    return {}
  }

  if (currentDetail.iconType === "image" && currentDetail.iconImage) {
    return {
      iconType: "image",
      icon: "",
      iconBg: "",
      iconImage: currentDetail.iconImage,
    }
  }

  return {
    iconType: "icon",
    icon: currentDetail.icon,
    iconBg: currentDetail.iconBg,
  }
}

async function applyIconImageBytes(
  deps: ContentCapabilityDispatcherDeps,
  payload: { iconImageBytes?: Uint8Array; iconType?: string },
  params: ContentToolParams,
  security?: ContentIconImageSecurityDeps,
): Promise<void> {
  if (payload.iconType !== "image") {
    return
  }
  if (!optionalTrimmedString(params.iconImagePath) && !optionalTrimmedString(params.iconImageBase64)) {
    return
  }

  const iconImageBytes = await deps.prepareIconImageBytes(params, security ?? deps.security)
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
): Promise<SynapseContentDetail> {
  const [identity, detail] = await Promise.all([
    deps.resolveCurrentIdentity(),
    deps.contentReader.getDetail(contentType, contentId),
  ])

  if (!isContentCreator(detail, identity.userId)) {
    throw new ContentCapabilityError("CONTENT_FORBIDDEN", "只能更新或删除自己发布的资源。", {
      details: {
        contentId,
        contentType,
      },
    })
  }

  return detail
}

function buildContentMutationSecurity(
  deps: ContentIconImageSecurityDeps | undefined,
  contentType: SynapseContentType,
  operation: MutatingContentOperation,
  action: string,
  params: ContentToolParams,
  context: DispatchContext,
): {
  readonly deps: ContentIconImageSecurityDeps
  readonly metadata: Record<string, unknown>
  readonly resource: string
} | null {
  if (!deps) return null
  const source = context.source ?? "api"
  const contentId = optionalTrimmedString(params.id)
  const metadata: Record<string, unknown> = {
    source,
    contentAction: action,
    contentType,
    operation,
  }
  if (contentId) metadata.contentId = contentId

  return {
    deps: { ...deps, actor: context.actor ?? deps.actor },
    metadata,
    resource: contentId ? `content:${contentType}:${contentId}` : `content:${contentType}:${operation}`,
  }
}

function buildContentReadSecurity(
  deps: ContentIconImageSecurityDeps | undefined,
  contentType: SynapseContentType,
  operation: ReadContentOperation,
  action: string,
  params: ContentToolParams,
  context: DispatchContext,
): {
  readonly deps: ContentIconImageSecurityDeps
  readonly metadata: Record<string, unknown>
  readonly resource: string
} | null {
  if (!deps) return null
  const source = context.source ?? "api"
  const contentId = optionalTrimmedString(params.id)
  const metadata: Record<string, unknown> = {
    source,
    contentAction: action,
    contentType,
    operation,
  }
  if (contentId) metadata.contentId = contentId
  if (operation === "list" && params.includeDeleted === true) metadata.includeDeleted = true

  return {
    deps: { ...deps, actor: context.actor ?? deps.actor },
    metadata,
    resource: contentId ? `content:${contentType}:${contentId}` : `content:${contentType}:${operation}`,
  }
}

async function authorizeContentRead(input: {
  readonly deps: ContentIconImageSecurityDeps
  readonly metadata: Record<string, unknown>
  readonly resource: string
}): Promise<void> {
  const permission = await checkCapabilityPermission({
    permissionGuard: input.deps.permissionGuard,
    auditSink: input.deps.auditSink,
    action: "content.read",
    actor: input.deps.actor,
    resource: input.resource,
    context: input.metadata,
  })
  if (!permission || permission.allowed) return

  input.deps.auditSink.record({
    action: "content.read",
    actor: input.deps.actor,
    resource: input.resource,
    outcome: "denied",
    metadata: {
      ...input.metadata,
      reason: permission.reason,
      policyId: permission.policyId,
    },
  })
  throw new ContentCapabilityError("CONTENT_FORBIDDEN", permission.reason)
}

async function authorizeContentMutation(input: {
  readonly deps: ContentIconImageSecurityDeps
  readonly metadata: Record<string, unknown>
  readonly resource: string
}): Promise<void> {
  const permission = await checkCapabilityPermission({
    permissionGuard: input.deps.permissionGuard,
    auditSink: input.deps.auditSink,
    action: "content.mutate",
    actor: input.deps.actor,
    resource: input.resource,
    context: input.metadata,
  })
  if (!permission || permission.allowed) return

  input.deps.auditSink.record({
    action: "content.mutate",
    actor: input.deps.actor,
    resource: input.resource,
    outcome: "denied",
    metadata: {
      ...input.metadata,
      reason: permission.reason,
      policyId: permission.policyId,
    },
  })
  throw new ContentCapabilityError("CONTENT_FORBIDDEN", permission.reason)
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

function optionalNonBlankString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : ""
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
