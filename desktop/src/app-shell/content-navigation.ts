import type { CreateSkillPayload, SkillCreateFilePayloadDraft } from "@/modules/skills/types"
import type { ContentCreateNotice } from "@/modules/content/types/create-notice"
import type { SynapseCreateRulePayload } from "@/types/content"

const OPEN_CONTENT_REQUEST_EVENT = "synapse:open-content-request"

export type EditOverwriteRulePrefill = {
  contentType: "rule"
  content: string
}

export type EditOverwriteSkillPrefill = {
  contentType: "skill"
  content: string
  files: SkillCreateFilePayloadDraft[]
}

export type ContentOpenRequest =
  | {
      kind: "create"
      requestId: string
      contentType: "rule"
      initialValue: SynapseCreateRulePayload
      sourceLabel: string
      notices?: ContentCreateNotice[]
      quickPublishSessionId?: string
    }
  | {
      kind: "create"
      requestId: string
      contentType: "skill"
      initialValue: CreateSkillPayload
      sourceLabel: string
      notices?: ContentCreateNotice[]
      quickPublishSessionId?: string
    }
  | {
      kind: "detail"
      requestId: string
      contentType: "rule" | "skill"
      contentId: string
    }
  | {
      kind: "edit-overwrite"
      requestId: string
      contentType: "rule"
      contentId: string
      prefill: EditOverwriteRulePrefill
      sourceLabel: string
      quickPublishSessionId?: string
    }
  | {
      kind: "edit-overwrite"
      requestId: string
      contentType: "skill"
      contentId: string
      prefill: EditOverwriteSkillPrefill
      sourceLabel: string
      quickPublishSessionId?: string
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

function requestOpenContentEditOverwrite(
  request: Extract<ContentOpenRequest, { kind: "edit-overwrite" }>,
): void {
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
  requestOpenContentEditOverwrite,
  subscribeContentOpenRequest,
}
