import { createEmptyRulePayload, normalizeCreateRulePayload } from "@/modules/rules/utils"
import type { CreateSkillPayload } from "@/modules/skills/types"
import {
  createEmptySkillPayload,
  normalizeCreateSkillPayload,
  normalizeSkillAttachmentName,
} from "@/modules/skills/utils"
import type {
  EditorScanQuickPublishDraft,
  ScanItemForDetail,
} from "@/types/editor-scan"
import type { SynapseCreateRulePayload } from "@/types/content"

type ParsedFrontmatter = {
  metadata: Record<string, string>
  body: string
}

function parseFrontmatter(text: string): ParsedFrontmatter {
  const metadata: Record<string, string> = {}
  if (!text.startsWith("---")) {
    return { metadata, body: text.trim() }
  }

  const endIndex = text.indexOf("\n---", 3)
  if (endIndex === -1) {
    return { metadata, body: text.trim() }
  }

  const block = text.slice(4, endIndex)
  for (const line of block.split("\n")) {
    const colonIndex = line.indexOf(":")
    if (colonIndex <= 0) continue
    const key = line.slice(0, colonIndex).trim()
    const value = line.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, "")
    if (key) {
      metadata[key] = value
    }
  }

  return {
    metadata,
    body: text.slice(endIndex + 4).trim(),
  }
}

function stripMarkdownExtension(name: string): string {
  return name.replace(/\.(md|mdc)$/i, "")
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath
}

function fallbackNameFromPath(itemName: string, itemPath: string): string {
  const baseName = itemName || basename(itemPath)
  return stripMarkdownExtension(baseName).trim()
}

function extractHeadingTitle(content: string): string | null {
  const heading = content.split("\n").find((line) => line.trim().startsWith("# "))
  return heading ? heading.replace(/^#\s*/, "").trim() || null : null
}

function extractFirstParagraph(content: string): string {
  const lines = content.split("\n")
  const paragraphLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      if (paragraphLines.length > 0) break
      continue
    }
    paragraphLines.push(trimmed)
  }

  return paragraphLines.join(" ").trim()
}

function buildRuleQuickPublishPayload(
  draft: Extract<EditorScanQuickPublishDraft, { itemType: "rule" }>,
): SynapseCreateRulePayload {
  const parsed = parseFrontmatter(draft.content)
  const metadata = { ...parsed.metadata, ...draft.metadata }
  const name = metadata.name || fallbackNameFromPath(draft.itemName, draft.itemPath)
  const title = extractHeadingTitle(parsed.body) || stripMarkdownExtension(draft.itemName)
  const description = metadata.description || extractFirstParagraph(parsed.body)

  return normalizeCreateRulePayload({
    ...createEmptyRulePayload(),
    name,
    title,
    description,
    category: "",
    icon: "file-text",
    content: draft.content,
  })
}

function buildSkillQuickPublishPayload(
  draft: Extract<EditorScanQuickPublishDraft, { itemType: "skill" }>,
): CreateSkillPayload {
  const parsed = parseFrontmatter(draft.content)
  const metadata = { ...parsed.metadata, ...draft.metadata }
  const name = metadata.name || fallbackNameFromPath(draft.itemName, draft.itemPath)
  const title = metadata.title || extractHeadingTitle(parsed.body) || name
  const description = metadata.description || extractFirstParagraph(parsed.body)

  return normalizeCreateSkillPayload({
    ...createEmptySkillPayload(),
    name,
    title,
    description,
    category: "",
    icon: "wrench",
    content: parsed.body,
    files: draft.files.map((file) => ({
      originalName: normalizeSkillAttachmentName(file.originalName),
      size: file.size,
      bytes: file.bytes,
    })),
  })
}

function formatQuickPublishSourceLabel(
  item: Pick<ScanItemForDetail, "editorLabel" | "scope" | "type">,
): string {
  const scopeLabel = item.scope === "global" ? "全局" : "项目"
  const typeLabel = item.type === "skill" ? "Skill" : "Rule"
  return `来自 ${item.editorLabel} · ${scopeLabel} ${typeLabel}`
}

export {
  buildRuleQuickPublishPayload,
  buildSkillQuickPublishPayload,
  formatQuickPublishSourceLabel,
}
