import { normalizeContentNameInput } from "./content-name-input"

const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const SKILL_NAME_MAX_LENGTH = 64

const WINDOWS_RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
])

function normalizeSkillNameInput(value: string): string {
  return normalizeContentNameInput(value)
}

function validateSkillNameInput(value: string): string | null {
  const normalized = normalizeSkillNameInput(value)

  if (normalized.length === 0) {
    return "请输入名称。"
  }

  if (normalized.length > SKILL_NAME_MAX_LENGTH) {
    return `名称最多 ${SKILL_NAME_MAX_LENGTH} 个字符。`
  }

  if (!SKILL_NAME_PATTERN.test(normalized)) {
    return "只能使用小写字母、数字、连字符；首尾必须是字母或数字。"
  }

  if (WINDOWS_RESERVED_NAMES.has(normalized)) {
    return "该名称是 Windows 系统保留字，请使用其他名称。"
  }

  return null
}

export {
  SKILL_NAME_MAX_LENGTH,
  SKILL_NAME_PATTERN,
  normalizeSkillNameInput,
  validateSkillNameInput,
}
