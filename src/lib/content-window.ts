import type {
  SynapseContentType,
  SynapseContentViewMode,
  SynapseContentWindowRequest,
  SynapseOpenContentWindowPayload,
} from "../types/content"

const CONTENT_WINDOW_KIND = "content-detail"
const CONTENT_WINDOW_KIND_PARAM = "synapseWindow"

function isContentType(value: string | null): value is SynapseContentType {
  return value === "rule" || value === "skill" || value === "prompt"
}

function normalizeViewMode(value: string | null): SynapseContentViewMode {
  return value === "source" ? "source" : "rendered"
}

function buildContentWindowSearchParams(
  payload: SynapseOpenContentWindowPayload,
): URLSearchParams {
  const params = new URLSearchParams({
    [CONTENT_WINDOW_KIND_PARAM]: CONTENT_WINDOW_KIND,
    contentType: payload.contentType,
    id: payload.id,
    viewMode: payload.viewMode,
  })

  if (payload.historyDirname) {
    params.set("historyDirname", payload.historyDirname)
  }

  return params
}

function parseContentWindowRequest(search: string): SynapseContentWindowRequest | null {
  const params = new URLSearchParams(search)

  if (params.get(CONTENT_WINDOW_KIND_PARAM) !== CONTENT_WINDOW_KIND) {
    return null
  }

  const contentType = params.get("contentType")
  const id = params.get("id")?.trim() ?? ""

  if (!isContentType(contentType) || id.length === 0) {
    return null
  }

  const historyDirname = params.get("historyDirname")?.trim() || undefined

  return {
    contentType,
    id,
    viewMode: normalizeViewMode(params.get("viewMode")),
    historyDirname,
  }
}

export {
  buildContentWindowSearchParams,
  parseContentWindowRequest,
}
