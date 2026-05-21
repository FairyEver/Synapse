import { describe, expect, it } from "vitest"
import type { EditorScanResult } from "@/types/editor-scan"
import {
  buildPromptShortcutOptions,
  completionTextForPromptShortcut,
  extractClaudeCodeGlobalSkillNames,
  matchPromptShortcutTrigger,
  shouldStartPromptShortcutCompletion,
} from "../prompt-shortcuts"

describe("prompt shortcuts", () => {
  it("builds variable options from non-empty variable names", () => {
    const options = buildPromptShortcutOptions({
      variables: [
        { name: "AAA输出", source: { type: "node_output", node: "node-1" } },
        { name: " ", source: { type: "static", value: "ignored" } },
      ],
      skillNames: [],
    })

    expect(options.variables).toEqual([{ label: "AAA输出", completionLabel: "@AAA输出", apply: "{{AAA输出}}" }])
  })

  it("builds completion labels with trigger prefixes so CodeMirror filtering keeps the menu open", () => {
    const options = buildPromptShortcutOptions({
      variables: [
        { name: "AAA输出", source: { type: "node_output", node: "node-1" } },
      ],
      skillNames: ["review-code"],
    })

    expect(options.variables[0]).toMatchObject({
      label: "AAA输出",
      completionLabel: "@AAA输出",
      apply: "{{AAA输出}}",
    })
    expect(options.skills[0]).toMatchObject({
      label: "review-code",
      completionLabel: "/review-code",
      apply: "skill: review-code",
    })
  })

  it("builds unique Skill options with the skill prefix insertion", () => {
    const options = buildPromptShortcutOptions({
      variables: [],
      skillNames: ["review-code", "review-code", "systematic-debugging", ""],
    })

    expect(options.skills).toEqual([
      { label: "review-code", completionLabel: "/review-code", apply: "skill: review-code" },
      { label: "systematic-debugging", completionLabel: "/systematic-debugging", apply: "skill: systematic-debugging" },
    ])
  })

  it("extracts only Claude Code global Skill names from editor scan results", () => {
    const scan: EditorScanResult = {
      global: [
        {
          editorId: "claude-code",
          editorLabel: "Claude Code",
          status: "detected",
          duplicateSkillNames: [],
          rulesSupported: true,
          rules: [],
          skills: [
            {
              name: "review-code",
              path: "/a",
              source: "external",
              synapseContentId: null,
              repositoryVersion: null,
              preview: "",
              fileCount: 1,
              trash: { mode: "path" },
            },
          ],
        },
        {
          editorId: "codex",
          editorLabel: "Codex",
          status: "detected",
          duplicateSkillNames: [],
          rulesSupported: true,
          rules: [],
          skills: [
            {
              name: "codex-only",
              path: "/b",
              source: "external",
              synapseContentId: null,
              repositoryVersion: null,
              preview: "",
              fileCount: 1,
              trash: { mode: "path" },
            },
          ],
        },
      ],
      projects: [],
    }

    expect(extractClaudeCodeGlobalSkillNames(scan)).toEqual(["review-code"])
  })

  it("matches shortcut triggers directly before the cursor", () => {
    expect(matchPromptShortcutTrigger("hello @AA", 9)).toEqual({ kind: "variable", from: 6, text: "@AA" })
    expect(matchPromptShortcutTrigger("run /review", 11)).toEqual({ kind: "skill", from: 4, text: "/review" })
    expect(matchPromptShortcutTrigger("https://example.com/a", 21)).toBeNull()
  })

  it("starts completion immediately after typing a prompt shortcut trigger", () => {
    expect(shouldStartPromptShortcutCompletion("@", 1)).toBe(true)
    expect(shouldStartPromptShortcutCompletion("run /", 5)).toBe(true)
    expect(shouldStartPromptShortcutCompletion("run /review", 11)).toBe(false)
  })

  it("returns insertion text for each shortcut kind", () => {
    expect(completionTextForPromptShortcut("variable", "AAA输出")).toBe("{{AAA输出}}")
    expect(completionTextForPromptShortcut("skill", "review-code")).toBe("skill: review-code")
  })
})
