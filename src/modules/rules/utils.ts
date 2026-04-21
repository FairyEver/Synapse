import { normalizeContentNameInput, validateContentNameInput } from "@/lib/content-name-input"
import type { SynapseCreateRulePayload } from "@/types/content"
import {
  createEmptyContentPayload,
  isContentPayloadDirty as isContentPayloadDirtyBase,
  normalizeContentPayload,
  validateContentPayload,
} from "@/modules/content/lib/content-payload"
import type { ContentFieldErrors } from "@/modules/content/lib/content-payload"

type RuleCreateFieldErrors = ContentFieldErrors & {
  name?: string
}

const RULE_CONFIG = {
  labels: {
    title: "请输入标题。",
    description: "请输入简介。",
    content: "请输入正文。",
  },
}

function createEmptyRulePayload(): SynapseCreateRulePayload {
  return createEmptyContentPayload<SynapseCreateRulePayload>({
    name: "",
  })
}

function normalizeCreateRulePayload(payload: SynapseCreateRulePayload): SynapseCreateRulePayload {
  const base = normalizeContentPayload(payload)
  return {
    ...base,
    name: normalizeContentNameInput(payload.name),
  }
}

function validateCreateRulePayload(payload: SynapseCreateRulePayload): RuleCreateFieldErrors {
  const baseErrors = validateContentPayload(payload, RULE_CONFIG)
  const errors: RuleCreateFieldErrors = baseErrors
  const normalizedPayload = normalizeCreateRulePayload(payload)

  const nameError = validateContentNameInput(normalizedPayload.name)
  if (nameError) {
    errors.name = nameError
  }

  return errors
}

function isCreateRulePayloadDirty(payload: SynapseCreateRulePayload): boolean {
  return isContentPayloadDirtyBase(payload, (p) => p.name !== "")
}

export {
  createEmptyRulePayload,
  isCreateRulePayloadDirty,
  normalizeCreateRulePayload,
  validateCreateRulePayload,
}

export type { RuleCreateFieldErrors }
