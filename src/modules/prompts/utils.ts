import {
  createEmptyContentPayload,
  isContentPayloadDirty as isContentPayloadDirtyBase,
  normalizeContentPayload,
  validateContentPayload,
} from "@/modules/content/lib/content-payload"
import type { CreatePromptPayload, PromptCreateFieldErrors } from "@/modules/prompts/types"

const PROMPT_CONFIG = {
  labels: {
    title: "请输入标题。",
    description: "请输入简介。",
    content: "请输入正文。",
  },
}

function createEmptyPromptPayload(): CreatePromptPayload {
  return createEmptyContentPayload<CreatePromptPayload>()
}

function normalizeCreatePromptPayload(payload: CreatePromptPayload): CreatePromptPayload {
  return normalizeContentPayload(payload)
}

function validateCreatePromptPayload(payload: CreatePromptPayload): PromptCreateFieldErrors {
  return validateContentPayload(payload, PROMPT_CONFIG)
}

function isCreatePromptPayloadDirty(payload: CreatePromptPayload): boolean {
  return isContentPayloadDirtyBase(payload)
}

export {
  createEmptyPromptPayload,
  isCreatePromptPayloadDirty,
  normalizeCreatePromptPayload,
  validateCreatePromptPayload,
}
