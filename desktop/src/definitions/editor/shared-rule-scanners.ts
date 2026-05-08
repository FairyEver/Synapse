import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import type { EditorScanRuleItem } from "../../types/editor-scan"
import { extractContentIdFromSynapseFile, isSynapseFile, pathExists } from "../../../electron/services/editor-adapters/utils"
import { parseFrontmatterBlock } from "./shared-yaml-scalar"

const SYNAPSE_RULE_BEGIN_RE = /<!--\s*synapse-rule:([A-Za-z0-9_.-]+):begin\s*-->/
const SYNAPSE_RULE_END_RE = /<!--\s*synapse-rule:[A-Za-z0-9_.-]+:end\s*-->/
const RULE_TRASH_UNSUPPORTED_REASON = "当前 Rule 没有明确边界，请在 Finder 中处理。"
const PATH_TRASH = { mode: "path" } as const

function createRuleSectionTrash(ruleId: string) {
  return { mode: "rule-section", ruleId } as const
}

function createUnsupportedRuleTrash() {
  return {
    mode: "unsupported",
    disabledReason: RULE_TRASH_UNSUPPORTED_REASON,
  } as const
}

async function warnScanFailure(message: string, details: { path: string; error: unknown }): Promise<void> {
  const { createMainLogger } = await import("../../../electron/services/log-store.js")
  createMainLogger("service.editor-scan").warn(message, details)
}

function previewLines(text: string, metadata?: Record<string, string>): string {
  return (metadata?.description?.trim() || text).split("\n").slice(0, 3).join("\n").trim()
}

async function readFullText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8")
  } catch {
    return ""
  }
}

function parseFrontmatter(text: string): { metadata: Record<string, string>; body: string } {
  if (!text.startsWith("---")) {
    return { metadata: {}, body: text }
  }
  const endIndex = text.indexOf("\n---", 3)
  if (endIndex === -1) {
    return { metadata: {}, body: text }
  }
  const block = text.slice(4, endIndex)
  const body = text.slice(endIndex + 4).trim()
  const { metadata } = parseFrontmatterBlock(block)
  return { metadata, body }
}

export async function scanClaudeCodeRules(dirPath: string): Promise<EditorScanRuleItem[]> {
  if (!(await pathExists(dirPath))) return []

  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const items: EditorScanRuleItem[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const filePath = path.join(dirPath, entry.name)

    try {
      const text = await readFullText(filePath)
      const { metadata, body } = parseFrontmatter(text)
      const synapse = isSynapseFile(entry.name)

      items.push({
        name: entry.name,
        path: filePath,
        source: synapse ? "synapse" : "external",
        synapseContentId: synapse ? extractContentIdFromSynapseFile(entry.name) : null,
        preview: previewLines(body, metadata),
        metadata,
        content: text,
        trash: PATH_TRASH,
      })
    } catch (error) {
      await warnScanFailure("Failed to scan Claude Code rule.", { path: filePath, error })
    }
  }

  return items
}

export async function scanCursorRules(dirPath: string): Promise<EditorScanRuleItem[]> {
  if (!(await pathExists(dirPath))) return []

  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const items: EditorScanRuleItem[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".mdc")) continue
    const filePath = path.join(dirPath, entry.name)

    try {
      const text = await readFullText(filePath)
      const { metadata, body } = parseFrontmatter(text)
      const synapse = isSynapseFile(entry.name)

      items.push({
        name: entry.name,
        path: filePath,
        source: synapse || metadata.description?.includes("synapse") ? "synapse" : "external",
        synapseContentId: synapse ? extractContentIdFromSynapseFile(entry.name) : null,
        preview: previewLines(body, metadata),
        metadata,
        content: text,
        trash: PATH_TRASH,
      })
    } catch (error) {
      await warnScanFailure("Failed to scan Cursor rule.", { path: filePath, error })
    }
  }

  return items
}

export async function scanCodexRules(filePath: string): Promise<EditorScanRuleItem[]> {
  if (!(await pathExists(filePath))) return []

  let text: string
  try {
    text = await readFullText(filePath)
  } catch {
    return []
  }

  if (!text.trim()) return []

  const items: EditorScanRuleItem[] = []
  const lines = text.split("\n")
  let i = 0

  while (i < lines.length) {
    const beginMatch = lines[i].match(SYNAPSE_RULE_BEGIN_RE)
    if (beginMatch) {
      const ruleId = beginMatch[1]
      const ruleLines: string[] = []
      i += 1
      while (i < lines.length && !SYNAPSE_RULE_END_RE.test(lines[i])) {
        ruleLines.push(lines[i])
        i += 1
      }
      i += 1
      items.push({
        name: ruleId,
        path: filePath,
        source: "synapse",
        synapseContentId: ruleId,
        preview: previewLines(ruleLines.join("\n")),
        metadata: {},
        content: ruleLines.join("\n").trim(),
        trash: createRuleSectionTrash(ruleId),
      })
      continue
    }
    i += 1
  }

  const unmarkedText = text.replace(
    /<!--\s*synapse-rule:[A-Za-z0-9_.-]+:begin\s*-->[\s\S]*?<!--\s*synapse-rule:[A-Za-z0-9_.-]+:end\s*-->/g,
    "",
  ).trim()

  if (!unmarkedText) return items

  const headings = unmarkedText.split(/^(?=# )/m).filter((section) => section.trim())
  if (headings.length > 1 || (headings.length === 1 && headings[0].startsWith("# "))) {
    for (const section of headings) {
      const firstLine = section.split("\n")[0].replace(/^#\s*/, "").trim()
      items.push({
        name: firstLine || "手写规则",
        path: filePath,
        source: "external",
        synapseContentId: null,
        preview: previewLines(section),
        metadata: {},
        content: section.trim(),
        trash: createUnsupportedRuleTrash(),
      })
    }
  } else {
    items.push({
      name: "手写规则",
      path: filePath,
      source: "external",
      synapseContentId: null,
      preview: previewLines(unmarkedText),
      metadata: {},
      content: unmarkedText,
      trash: createUnsupportedRuleTrash(),
    })
  }

  return items
}
