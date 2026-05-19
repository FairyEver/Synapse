import type { EditorScanResult } from "@/types/editor-scan"
import type { VariableBinding } from "./schemas/variable-binding"

export type PromptShortcutKind = "variable" | "skill"

export interface PromptShortcutOption {
  label: string
  completionLabel: string
  apply: string
}

export interface PromptShortcutTriggerMatch {
  kind: PromptShortcutKind
  from: number
  text: string
}

export function completionTextForPromptShortcut(kind: PromptShortcutKind, label: string): string {
  return kind === "variable" ? `{{${label}}}` : `skill: ${label}`
}

export function buildPromptShortcutOptions({
  variables,
  skillNames,
}: {
  variables: readonly VariableBinding[]
  skillNames: readonly string[]
}): { variables: PromptShortcutOption[]; skills: PromptShortcutOption[] } {
  const variableNames = uniqueNonEmpty(variables.map((variable) => variable.name))
  const uniqueSkillNames = uniqueNonEmpty(skillNames)

  return {
    variables: variableNames.map((label) => ({
      label,
      completionLabel: `@${label}`,
      apply: completionTextForPromptShortcut("variable", label),
    })),
    skills: uniqueSkillNames.map((label) => ({
      label,
      completionLabel: `/${label}`,
      apply: completionTextForPromptShortcut("skill", label),
    })),
  }
}

export function extractClaudeCodeGlobalSkillNames(scan: EditorScanResult | null | undefined): string[] {
  const claudeCodeGlobal = scan?.global.find((entry) => entry.editorId === "claude-code")
  return uniqueNonEmpty(claudeCodeGlobal?.skills.map((skill) => skill.name) ?? [])
}

export function matchPromptShortcutTrigger(doc: string, pos: number): PromptShortcutTriggerMatch | null {
  const beforeCursor = doc.slice(0, pos)
  const match = /(^|\s)([@/][^\s@/]*)$/.exec(beforeCursor)
  if (!match) return null

  const text = match[2]
  return {
    kind: text.startsWith("@") ? "variable" : "skill",
    from: pos - text.length,
    text,
  }
}

export function shouldStartPromptShortcutCompletion(doc: string, pos: number): boolean {
  const trigger = doc.at(pos - 1)
  return trigger === "@" || trigger === "/"
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}
