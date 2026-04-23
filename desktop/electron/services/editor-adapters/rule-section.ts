const RULE_ID_PATTERN = /^[A-Za-z0-9_.-]+$/

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildBeginMarker(ruleId: string): string {
  return `<!-- synapse-rule:${ruleId}:begin -->`
}

function buildEndMarker(ruleId: string): string {
  return `<!-- synapse-rule:${ruleId}:end -->`
}

function normalizeBlockBody(body: string): string {
  return body.replace(/\s+$/u, "")
}

function buildSectionBlock(ruleId: string, body: string): string {
  return `${buildBeginMarker(ruleId)}\n${normalizeBlockBody(body)}\n${buildEndMarker(ruleId)}`
}

function applyRuleSection(existingContent: string, ruleId: string, body: string): string {
  if (!RULE_ID_PATTERN.test(ruleId)) {
    throw new Error(`无法在 Markdown 中安全嵌入 Rule ID：${ruleId}`)
  }

  const block = buildSectionBlock(ruleId, body)
  const escapedId = escapeForRegex(ruleId)
  const sectionPattern = new RegExp(
    `<!-- synapse-rule:${escapedId}:begin -->[\\s\\S]*?<!-- synapse-rule:${escapedId}:end -->`,
    "u",
  )

  if (sectionPattern.test(existingContent)) {
    return existingContent.replace(sectionPattern, block)
  }

  const trimmed = existingContent.replace(/\s+$/u, "")

  if (trimmed.length === 0) {
    return `${block}\n`
  }

  return `${trimmed}\n\n${block}\n`
}

export { applyRuleSection }
