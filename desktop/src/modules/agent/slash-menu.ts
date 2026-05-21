import type { SynapseAgentPublishedCommand } from "@/types/agent"

export type AgentSlashCandidateKind = "skill" | "command"

export type AgentSlashCandidate = {
  readonly name: string
  readonly description?: string
  readonly kind: AgentSlashCandidateKind
  readonly source: SynapseAgentPublishedCommand["source"]
}

export type AgentSlashFragment = {
  readonly start: number
  readonly end: number
  readonly query: string
}

export type AgentSlashGroup = {
  readonly kind: AgentSlashCandidateKind
  readonly label: "Skills" | "Commands"
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
    }))
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
): { readonly value: string; readonly cursor: number } {
  const insertion = `/${name.replace(/^\/+/, "")}`
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
  return candidates.filter((candidate) => {
    const name = candidate.name.toLowerCase()
    const description = candidate.description?.toLowerCase() ?? ""
    return name.includes(normalized) || description.includes(normalized)
  })
}

export function groupAgentSlashCandidates(
  candidates: readonly AgentSlashCandidate[],
): AgentSlashGroup[] {
  const skills = candidates.filter((candidate) => candidate.kind === "skill")
  const commands = candidates.filter((candidate) => candidate.kind === "command")
  return [
    skills.length > 0 ? { kind: "skill", label: "Skills" as const, items: skills } : null,
    commands.length > 0 ? { kind: "command", label: "Commands" as const, items: commands } : null,
  ].filter((group): group is AgentSlashGroup => group !== null)
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
