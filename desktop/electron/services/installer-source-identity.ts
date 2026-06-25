import { createHash } from "node:crypto"
import { normalizeContentNameInput } from "../../src/lib/content-name-input"

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function createLocalSkillSourceIdentity(realSourceDirectoryPath: string): string {
  return `local-skill:${sha256(realSourceDirectoryPath)}`
}

function createInlineRuleSourceIdentity(name: string, body: string): string {
  const normalizedName = normalizeContentNameInput(name)
  return `inline-rule:${sha256(`${normalizedName}\0${body}`)}`
}

export {
  createInlineRuleSourceIdentity,
  createLocalSkillSourceIdentity,
}
