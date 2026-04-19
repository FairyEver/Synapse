import {
  createEmptyContentPayload,
  isContentPayloadDirty as isContentPayloadDirtyBase,
  normalizeContentPayload,
  validateContentPayload,
} from "@/modules/content/lib/content-payload"
import type { CreateRulePayload, RuleCreateFieldErrors } from "@/modules/rules/types"

const RULE_CONFIG = {
  labels: {
    title: "请输入标题。",
    description: "请输入简介。",
    content: "请输入正文。",
  },
}

function createEmptyRulePayload(): CreateRulePayload {
  return createEmptyContentPayload<CreateRulePayload>()
}

function normalizeCreateRulePayload(payload: CreateRulePayload): CreateRulePayload {
  return normalizeContentPayload(payload)
}

function validateCreateRulePayload(payload: CreateRulePayload): RuleCreateFieldErrors {
  return validateContentPayload(payload, RULE_CONFIG)
}

function isCreateRulePayloadDirty(payload: CreateRulePayload): boolean {
  return isContentPayloadDirtyBase(payload)
}

export {
  createEmptyRulePayload,
  isCreateRulePayloadDirty,
  normalizeCreateRulePayload,
  validateCreateRulePayload,
}
