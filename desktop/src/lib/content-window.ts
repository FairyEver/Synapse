import type {
  SynapseContentType,
  SynapseContentViewMode,
  SynapseContentWindowRequest,
  SynapseOpenContentCreateWindowPayload,
  SynapseOpenContentDetailWindowPayload,
  SynapseOpenContentEditWindowPayload,
  SynapseOpenContentWindowPayload,
} from "../types/content"

const CONTENT_WINDOW_KIND = "content"
const LEGACY_CONTENT_DETAIL_WINDOW_KIND = "content-detail"
const CONTENT_WINDOW_KIND_PARAM = "synapseWindow"
const CONTENT_WINDOW_KIND_DETAIL = "detail"
const CONTENT_WINDOW_KIND_CREATE = "create"
const CONTENT_WINDOW_KIND_EDIT = "edit"

function isContentType(value: string | null): value is SynapseContentType {
  return value === "rule" || value === "skill" || value === "prompt"
}

function normalizeViewMode(value: string | null): SynapseContentViewMode {
  return value === "source" ? "source" : "rendered"
}

function normalizeWindowKind(value: string | null): "detail" | "create" | "edit" | null {
  if (
    value === CONTENT_WINDOW_KIND_DETAIL
    || value === CONTENT_WINDOW_KIND_CREATE
    || value === CONTENT_WINDOW_KIND_EDIT
  ) {
    return value
  }

  return null
}

function normalizeEditOrigin(value: string | null): "detail" | "external" {
  return value === "external" ? "external" : "detail"
}

function appendRequestId(params: URLSearchParams, requestId?: string): URLSearchParams {
  const trimmedRequestId = requestId?.trim() ?? ""

  if (trimmedRequestId.length > 0) {
    params.set("requestId", trimmedRequestId)
  }

  return params
}

function buildContentDetailWindowSearchParams(
  payload: SynapseOpenContentDetailWindowPayload,
): URLSearchParams {
  return new URLSearchParams({
    [CONTENT_WINDOW_KIND_PARAM]: CONTENT_WINDOW_KIND,
    windowKind: CONTENT_WINDOW_KIND_DETAIL,
    contentType: payload.contentType,
    id: payload.id,
    viewMode: payload.viewMode,
  })
}

function buildContentCreateWindowSearchParams(
  payload: SynapseOpenContentCreateWindowPayload,
): URLSearchParams {
  return appendRequestId(new URLSearchParams({
    [CONTENT_WINDOW_KIND_PARAM]: CONTENT_WINDOW_KIND,
    windowKind: CONTENT_WINDOW_KIND_CREATE,
    contentType: payload.contentType,
  }), payload.requestId)
}

function buildContentEditWindowSearchParams(
  payload: SynapseOpenContentEditWindowPayload,
): URLSearchParams {
  return appendRequestId(new URLSearchParams({
    [CONTENT_WINDOW_KIND_PARAM]: CONTENT_WINDOW_KIND,
    windowKind: CONTENT_WINDOW_KIND_EDIT,
    contentType: payload.contentType,
    id: payload.id,
    origin: payload.origin,
  }), payload.requestId)
}

function buildContentWindowSearchParams(
  payload: SynapseOpenContentWindowPayload,
): URLSearchParams {
  return buildContentDetailWindowSearchParams(payload)
}

function parseContentWindowRequest(search: string): SynapseContentWindowRequest | null {
  const params = new URLSearchParams(search)
  const contentWindowKind = params.get(CONTENT_WINDOW_KIND_PARAM)

  if (contentWindowKind !== CONTENT_WINDOW_KIND && contentWindowKind !== LEGACY_CONTENT_DETAIL_WINDOW_KIND) {
    return null
  }

  const contentType = params.get("contentType")
  const id = params.get("id")?.trim() ?? ""

  if (!isContentType(contentType)) {
    return null
  }

  const requestId = params.get("requestId")?.trim() || undefined
  const windowKind = contentWindowKind === LEGACY_CONTENT_DETAIL_WINDOW_KIND
    ? CONTENT_WINDOW_KIND_DETAIL
    : normalizeWindowKind(params.get("windowKind"))

  if (windowKind === CONTENT_WINDOW_KIND_CREATE) {
    return {
      kind: "create",
      contentType,
      ...(requestId ? { requestId } : {}),
    }
  }

  if (id.length === 0) {
    return null
  }

  if (windowKind === CONTENT_WINDOW_KIND_EDIT) {
    return {
      kind: "edit",
      contentType,
      id,
      origin: normalizeEditOrigin(params.get("origin")),
      ...(requestId ? { requestId } : {}),
    }
  }

  if (windowKind !== CONTENT_WINDOW_KIND_DETAIL) {
    return null
  }

  return {
    kind: "detail",
    contentType,
    id,
    viewMode: normalizeViewMode(params.get("viewMode")),
  }
}

export {
  buildContentCreateWindowSearchParams,
  buildContentDetailWindowSearchParams,
  buildContentEditWindowSearchParams,
  buildContentWindowSearchParams,
  parseContentWindowRequest,
}
