import type { CreateRulePayload, RuleCreateFieldErrors } from "@/modules/rules/types"

const EMPTY_CREATE_RULE_PAYLOAD: CreateRulePayload = {
  title: "",
  description: "",
  category: "",
  icon: "",
  iconBg: "",
  content: "",
}

function createEmptyRulePayload(): CreateRulePayload {
  return {
    ...EMPTY_CREATE_RULE_PAYLOAD,
  }
}

function normalizeCreateRulePayload(payload: CreateRulePayload): CreateRulePayload {
  return {
    ...payload,
    title: payload.title.trim(),
    description: payload.description.trim(),
    content: payload.content.trim(),
  }
}

function validateCreateRulePayload(payload: CreateRulePayload): RuleCreateFieldErrors {
  const normalizedPayload = normalizeCreateRulePayload(payload)
  const errors: RuleCreateFieldErrors = {}

  if (!normalizedPayload.title) {
    errors.title = "请输入标题。"
  }

  if (!normalizedPayload.description) {
    errors.description = "请输入简介。"
  }

  if (!normalizedPayload.category) {
    errors.category = "请选择分类。"
  }

  if (!normalizedPayload.icon) {
    errors.icon = "请选择图标。"
  }

  if (!normalizedPayload.iconBg) {
    errors.iconBg = "请选择背景色。"
  }

  if (!normalizedPayload.content) {
    errors.content = "请输入正文。"
  }

  return errors
}

function isCreateRulePayloadDirty(payload: CreateRulePayload): boolean {
  return Object.values(payload).some((value) => value !== "")
}

export {
  createEmptyRulePayload,
  isCreateRulePayloadDirty,
  normalizeCreateRulePayload,
  validateCreateRulePayload,
}
