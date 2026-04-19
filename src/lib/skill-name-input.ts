const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const SKILL_NAME_MAX_LENGTH = 64

function normalizeSkillNameInput(value: string): string {
  return value.trim().toLowerCase()
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

  return null
}

export {
  SKILL_NAME_MAX_LENGTH,
  SKILL_NAME_PATTERN,
  normalizeSkillNameInput,
  validateSkillNameInput,
}
