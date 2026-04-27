import type { CreateSkillPayload } from "@/modules/skills/types"
import type { SynapseCreateRulePayload } from "@/types/content"

const OPEN_CONTENT_REQUEST_EVENT = "synapse:open-content-request"

export type ContentOpenRequest =
  | {
      kind: "create"
      requestId: string
      contentType: "rule"
      initialValue: SynapseCreateRulePayload
      sourceLabel: string
    }
  | {
      kind: "create"
      requestId: string
      contentType: "skill"
      initialValue: CreateSkillPayload
      sourceLabel: string
    }
  | {
      kind: "detail"
      requestId: string
      contentType: "rule" | "skill"
      contentId: string
    }

function createContentOpenRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function requestOpenContentCreate(request: Extract<ContentOpenRequest, { kind: "create" }>): void {
  window.dispatchEvent(new CustomEvent(OPEN_CONTENT_REQUEST_EVENT, { detail: request }))
}

function requestOpenContentDetail(request: Extract<ContentOpenRequest, { kind: "detail" }>): void {
  window.dispatchEvent(new CustomEvent(OPEN_CONTENT_REQUEST_EVENT, { detail: request }))
}

function subscribeContentOpenRequest(
  listener: (request: ContentOpenRequest) => void,
): () => void {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<ContentOpenRequest>).detail)
  }

  window.addEventListener(OPEN_CONTENT_REQUEST_EVENT, handleEvent)

  return () => {
    window.removeEventListener(OPEN_CONTENT_REQUEST_EVENT, handleEvent)
  }
}

export {
  createContentOpenRequestId,
  requestOpenContentCreate,
  requestOpenContentDetail,
  subscribeContentOpenRequest,
}
