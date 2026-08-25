import type { SynapseAgentPublishedCommand } from "@/types/agent"

export type AgentSlashCandidateKind = "knowledgeBase" | "skill" | "command"

export type AgentSlashCandidate = {
  readonly name: string
  readonly description?: string
  readonly kind: AgentSlashCandidateKind
  readonly source?: SynapseAgentPublishedCommand["source"]
  readonly skillOrigin?: SynapseAgentPublishedCommand["skillOrigin"]
  readonly insertText?: string
}

export type AgentSlashFragment = {
  readonly start: number
  readonly end: number
  readonly query: string
}

export type AgentSlashGroup = {
  readonly kind: "recentSkill" | "installedSkill" | "otherSkill" | "knowledgeBase" | "command"
  readonly label: "最近使用" | "我的 Skills" | "其它 Skills" | "知识库" | "其它命令"
  readonly items: readonly AgentSlashCandidate[]
}

const FRAGMENT_BOUNDARY = /\s/

export function toAgentSlashCandidates(
  commands: readonly SynapseAgentPublishedCommand[],
): AgentSlashCandidate[] {
  return commands
    .filter((command) => command.name.trim().length > 0)
    .map((command) => ({
      name: command.name.replace(/^\/+/, ""),
      description: command.description,
      kind: command.kind === "skill" || command.source === "skill" ? "skill" : "command",
      source: command.source,
      ...(command.skillOrigin ? { skillOrigin: command.skillOrigin } : {}),
      insertText: command.ui?.insertText,
    }))
}

export function uniqueAgentSlashCandidates(
  candidates: readonly AgentSlashCandidate[],
): AgentSlashCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = candidate.name.trim().replace(/^\/+/, "").toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function findAgentSlashFragment(value: string, cursor: number): AgentSlashFragment | null {
  const safeCursor = Math.max(0, Math.min(cursor, value.length))
  const tokenStart = findTokenStart(value, safeCursor)
  const slashIndex = value.lastIndexOf("/", safeCursor - 1)
  if (slashIndex < tokenStart) return null

  const end = findTokenEnd(value, slashIndex)
  if (safeCursor < slashIndex + 1 || safeCursor > end) return null

  return {
    start: slashIndex,
    end,
    query: value.slice(slashIndex + 1, safeCursor),
  }
}

export function replaceAgentSlashFragment(
  value: string,
  fragment: AgentSlashFragment,
  name: string,
  insertText?: string,
): { readonly value: string; readonly cursor: number } {
  const insertion = insertText ?? `/${name.replace(/^\/+/, "")}`
  const nextValue = `${value.slice(0, fragment.start)}${insertion}${value.slice(fragment.end)}`
  return {
    value: nextValue,
    cursor: fragment.start + insertion.length,
  }
}

export function filterAgentSlashCandidates(
  candidates: readonly AgentSlashCandidate[],
  query: string,
): AgentSlashCandidate[] {
  const normalized = query.trim().replace(/^\/+/, "").toLowerCase()
  if (!normalized) return [...candidates]
  const namePrefixMatches = candidates.filter((candidate) =>
    candidate.name.toLowerCase().startsWith(normalized))
  if (namePrefixMatches.length > 0) return namePrefixMatches

  const nameContainsMatches = candidates.filter((candidate) =>
    candidate.name.toLowerCase().includes(normalized))
  if (nameContainsMatches.length > 0) return nameContainsMatches

  return candidates.filter((candidate) =>
    candidate.description?.toLowerCase().includes(normalized) ?? false)
}

export function groupAgentSlashCandidates(
  candidates: readonly AgentSlashCandidate[],
  recentSkillNames: readonly string[] = [],
): AgentSlashGroup[] {
  const knowledgeBase = candidates.filter((candidate) => candidate.kind === "knowledgeBase")
  const skills = candidates.filter((candidate) => candidate.kind === "skill")
  const commands = candidates.filter((candidate) => candidate.kind === "command")
  const skillsByName = new Map(skills.map((candidate) => [normalizeCandidateName(candidate.name), candidate]))
  const seenRecentNames = new Set<string>()
  const recentSkills = recentSkillNames
    .map((name) => skillsByName.get(normalizeCandidateName(name)))
    .filter((candidate): candidate is AgentSlashCandidate => {
      if (!candidate) return false
      const name = normalizeCandidateName(candidate.name)
      if (seenRecentNames.has(name)) return false
      seenRecentNames.add(name)
      return true
    })
    .slice(0, 3)
  const recentNames = new Set(recentSkills.map((candidate) => normalizeCandidateName(candidate.name)))
  const remainingSkills = skills.filter((candidate) => !recentNames.has(normalizeCandidateName(candidate.name)))
  const installedSkills = remainingSkills.filter((candidate) => candidate.skillOrigin === "synapse-installed")
  const otherSkills = remainingSkills.filter((candidate) => candidate.skillOrigin !== "synapse-installed")
  const groups: AgentSlashGroup[] = []
  if (recentSkills.length > 0) {
    groups.push({ kind: "recentSkill", label: "最近使用", items: recentSkills })
  }
  if (installedSkills.length > 0) {
    groups.push({ kind: "installedSkill", label: "我的 Skills", items: installedSkills })
  }
  if (otherSkills.length > 0) {
    groups.push({ kind: "otherSkill", label: "其它 Skills", items: otherSkills })
  }
  if (knowledgeBase.length > 0) {
    groups.push({ kind: "knowledgeBase", label: "知识库", items: knowledgeBase })
  }
  if (commands.length > 0) {
    groups.push({ kind: "command", label: "其它命令", items: commands })
  }
  return groups
}

export function orderAgentSlashCandidates(
  candidates: readonly AgentSlashCandidate[],
  recentSkillNames: readonly string[] = [],
): AgentSlashCandidate[] {
  return groupAgentSlashCandidates(candidates, recentSkillNames).flatMap((group) => group.items)
}

export function submittedSlashSkillName(
  content: string,
  candidates: readonly AgentSlashCandidate[],
): string | null {
  const [firstToken] = content.trim().split(/\s+/, 1)
  if (!firstToken?.startsWith("/")) return null
  const submittedName = normalizeCandidateName(firstToken)
  const skill = candidates.find((candidate) =>
    candidate.kind === "skill" && normalizeCandidateName(candidate.name) === submittedName)
  return skill ? normalizeCandidateName(skill.name) : null
}

export function nextRecentSlashSkills(
  current: readonly string[],
  skillName: string,
): string[] {
  const normalized = normalizeCandidateName(skillName)
  if (!normalized) return current.slice(0, 3)
  return [
    normalized,
    ...current
      .map(normalizeCandidateName)
      .filter((name, index, items) => name && name !== normalized && items.indexOf(name) === index),
  ].slice(0, 3)
}

function normalizeCandidateName(name: string): string {
  return name.trim().replace(/^\/+/, "").toLowerCase()
}

function findTokenStart(value: string, cursor: number): number {
  let start = cursor
  while (start > 0 && !FRAGMENT_BOUNDARY.test(value[start - 1] ?? "")) {
    start -= 1
  }
  return start
}

function findTokenEnd(value: string, start: number): number {
  let end = start + 1
  while (end < value.length && !FRAGMENT_BOUNDARY.test(value[end] ?? "")) {
    end += 1
  }
  return end
}
