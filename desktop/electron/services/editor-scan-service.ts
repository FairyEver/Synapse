import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import type {
  EditorScanGlobalResult,
  EditorScanItemSource,
  EditorScanProjectEntry,
  EditorScanProjectResult,
  EditorScanResult,
  EditorScanRuleItem,
  EditorScanSkillItem,
} from "../../src/types/editor-scan"
import type { SynapseEditorId } from "../../src/types/editor"
import { editorAdapters } from "./editor-adapters"
import { getHomePath, pathExists, expandHomeDirectory } from "./editor-adapters/utils"
import { configStore } from "./config-store"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("service.editor-scan")
const PREVIEW_BYTE_LIMIT = 512
const SYNAPSE_SKILL_ID_FILE = ".synapse.json"
const SYNAPSE_RULE_BEGIN_RE = /<!--\s*synapse-rule:([^:]+):begin\s*-->/
const SYNAPSE_RULE_END_RE = /<!--\s*synapse-rule:[^:]+:end\s*-->/

// --- helpers ---

function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text
  const endIndex = text.indexOf("\n---", 3)
  if (endIndex === -1) return text
  return text.slice(endIndex + 4).trim()
}

function previewLines(text: string): string {
  return stripFrontmatter(text).split("\n").slice(0, 3).join("\n").trim()
}

async function readPreview(filePath: string): Promise<string> {
  try {
    const buf = Buffer.alloc(PREVIEW_BYTE_LIMIT)
    const { open } = await import("node:fs/promises")
    const fd = await open(filePath, "r")
    try {
      const { bytesRead } = await fd.read(buf, 0, PREVIEW_BYTE_LIMIT, 0)
      const raw = buf.subarray(0, bytesRead).toString("utf8")
      return previewLines(raw)
    } finally {
      await fd.close()
    }
  } catch {
    return ""
  }
}

async function readFullText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8")
  } catch {
    return ""
  }
}

async function readSynapseSkillMeta(
  skillDir: string,
): Promise<{ id: string } | null> {
  try {
    const raw = await readFile(path.join(skillDir, SYNAPSE_SKILL_ID_FILE), "utf8")
    const meta = JSON.parse(raw) as { id?: string }
    return meta.id ? { id: meta.id } : null
  } catch {
    return null
  }
}

function parseFrontmatter(text: string): { metadata: Record<string, string>; body: string } {
  const metadata: Record<string, string> = {}
  if (!text.startsWith("---")) {
    return { metadata, body: text }
  }
  const endIndex = text.indexOf("\n---", 3)
  if (endIndex === -1) {
    return { metadata, body: text }
  }
  const frontmatterBlock = text.slice(4, endIndex)
  for (const line of frontmatterBlock.split("\n")) {
    const colonIndex = line.indexOf(":")
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim()
      const value = line.slice(colonIndex + 1).trim()
      if (key) {
        metadata[key] = value
      }
    }
  }
  const body = text.slice(endIndex + 4).trim()
  return { metadata, body }
}

// --- skill scanning ---

async function scanSkillsDirectory(dirPath: string): Promise<EditorScanSkillItem[]> {
  if (!(await pathExists(dirPath))) return []

  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const items: EditorScanSkillItem[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillDir = path.join(dirPath, entry.name)

    try {
      const meta = await readSynapseSkillMeta(skillDir)
      const source: EditorScanItemSource = meta ? "synapse" : "external"

      const children = await readdir(skillDir)
      const mdFiles = children.filter((f) => f.endsWith(".md"))
      if (mdFiles.length === 0 && !meta) continue

      let previewFile: string | null = null
      if (mdFiles.includes("SKILL.md")) {
        previewFile = path.join(skillDir, "SKILL.md")
      } else if (mdFiles.length > 0) {
        mdFiles.sort()
        previewFile = path.join(skillDir, mdFiles[0])
      }

      const preview = previewFile ? await readPreview(previewFile) : ""

      items.push({
        name: entry.name,
        path: skillDir,
        source,
        synapseContentId: meta?.id ?? null,
        preview,
        fileCount: children.length,
      })
    } catch (error) {
      logger.warn("Failed to scan skill directory.", { path: skillDir, error })
    }
  }

  return items
}

// --- rule scanning ---

async function scanClaudeCodeRules(dirPath: string): Promise<EditorScanRuleItem[]> {
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
      const isSynapse = entry.name.startsWith("synapse_")

      items.push({
        name: entry.name,
        path: filePath,
        source: isSynapse ? "synapse" : "external",
        synapseContentId: isSynapse ? entry.name.replace(/^synapse_/, "").replace(/\.md$/, "") : null,
        preview: previewLines(body),
        metadata,
      })
    } catch (error) {
      logger.warn("Failed to scan Claude Code rule.", { path: filePath, error })
    }
  }

  return items
}

async function scanCursorRules(dirPath: string): Promise<EditorScanRuleItem[]> {
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
      const contentId = entry.name.replace(/\.mdc$/, "")

      items.push({
        name: entry.name,
        path: filePath,
        source: metadata.description?.includes("synapse") ? "synapse" : "external",
        synapseContentId: null,
        preview: previewLines(body),
        metadata,
      })
    } catch (error) {
      logger.warn("Failed to scan Cursor rule.", { path: filePath, error })
    }
  }

  return items
}

async function scanCodexRules(filePath: string): Promise<EditorScanRuleItem[]> {
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
      })
      continue
    }
    i += 1
  }

  const unmarkedText = text.replace(
    /<!--\s*synapse-rule:[^:]+:begin\s*-->[\s\S]*?<!--\s*synapse-rule:[^:]+:end\s*-->/g,
    "",
  ).trim()

  if (!unmarkedText) return items

  const headings = unmarkedText.split(/^(?=# )/m).filter((s) => s.trim())
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
    })
  }

  return items
}

// --- per-editor scan helpers ---

type EditorScanPaths = {
  editorId: SynapseEditorId
  editorLabel: string
  globalSkillsPath: string | null
  globalRulesPath: string | null
  rulesSupported: boolean
  detectionDir: string
}

function resolveCodexHomePath(): string {
  const env = process.env.CODEX_HOME?.trim()
  if (env) return path.resolve(expandHomeDirectory(env))
  return getHomePath(".codex")
}

function getEditorScanPaths(): EditorScanPaths[] {
  return [
    {
      editorId: "claude-code",
      editorLabel: "Claude Code",
      globalSkillsPath: getHomePath(".claude", "skills"),
      globalRulesPath: getHomePath(".claude", "rules"),
      rulesSupported: true,
      detectionDir: getHomePath(".claude"),
    },
    {
      editorId: "cursor",
      editorLabel: "Cursor",
      globalSkillsPath: getHomePath(".cursor", "skills"),
      globalRulesPath: null,
      rulesSupported: false,
      detectionDir: getHomePath(".cursor"),
    },
    {
      editorId: "codex",
      editorLabel: "Codex",
      globalSkillsPath: getHomePath(".agents", "skills"),
      globalRulesPath: path.join(resolveCodexHomePath(), "AGENTS.md"),
      rulesSupported: true,
      detectionDir: resolveCodexHomePath(),
    },
  ]
}

async function scanRulesForEditor(
  editorId: SynapseEditorId,
  rulesPath: string | null,
): Promise<EditorScanRuleItem[]> {
  if (!rulesPath) return []
  switch (editorId) {
    case "claude-code":
      return scanClaudeCodeRules(rulesPath)
    case "cursor":
      return scanCursorRules(rulesPath)
    case "codex":
      return scanCodexRules(rulesPath)
    default:
      return []
  }
}

function getProjectEditorPaths(
  projectPath: string,
): Array<{
  editorId: SynapseEditorId
  editorLabel: string
  skillsPath: string
  rulesPath: string
}> {
  return [
    {
      editorId: "claude-code",
      editorLabel: "Claude Code",
      skillsPath: path.join(projectPath, ".claude", "skills"),
      rulesPath: path.join(projectPath, ".claude", "rules"),
    },
    {
      editorId: "cursor",
      editorLabel: "Cursor",
      skillsPath: path.join(projectPath, ".cursor", "skills"),
      rulesPath: path.join(projectPath, ".cursor", "rules"),
    },
    {
      editorId: "codex",
      editorLabel: "Codex",
      skillsPath: path.join(projectPath, ".agents", "skills"),
      rulesPath: path.join(projectPath, "AGENTS.md"),
    },
  ]
}

async function scanProject(
  projectPath: string,
  projectName: string,
): Promise<EditorScanProjectResult> {
  const exists = await pathExists(projectPath)
  if (!exists) {
    return { projectPath, projectName, pathExists: false, editors: [] }
  }

  const editorPaths = getProjectEditorPaths(projectPath)
  const editors = await Promise.all(
    editorPaths.map(async (ep): Promise<EditorScanProjectEntry> => {
      const [skills, rules] = await Promise.all([
        scanSkillsDirectory(ep.skillsPath),
        scanRulesForEditor(ep.editorId, ep.rulesPath),
      ])
      return {
        editorId: ep.editorId,
        editorLabel: ep.editorLabel,
        skills,
        rules,
      }
    }),
  )

  return { projectPath, projectName, pathExists: true, editors }
}

// --- main export ---

async function scanAll(): Promise<EditorScanResult> {
  const editorPaths = getEditorScanPaths()

  const globalPromise = Promise.all(
    editorPaths.map(async (ep): Promise<EditorScanGlobalResult> => {
      const detected = await pathExists(ep.detectionDir)
      const [skills, rules] = await Promise.all([
        scanSkillsDirectory(ep.globalSkillsPath ?? ""),
        scanRulesForEditor(ep.editorId, ep.globalRulesPath),
      ])
      return {
        editorId: ep.editorId,
        editorLabel: ep.editorLabel,
        status: detected ? "detected" : "not-detected",
        skills,
        rules,
        rulesSupported: ep.rulesSupported,
      }
    }),
  )

  const config = await configStore.load()
  const projects = config.global.projects

  const projectsPromise = Promise.all(
    projects.map((p) => scanProject(p.path, p.name)),
  )

  const [global, projectResults] = await Promise.all([globalPromise, projectsPromise])

  return { global, projects: projectResults }
}

export { scanAll }
