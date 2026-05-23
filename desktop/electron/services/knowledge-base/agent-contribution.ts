import { readFile } from "node:fs/promises"
import path from "node:path"

import type { SynapseProjectConfig } from "../../../src/types/config"
import type { RegisteredPromptCommandOutput } from "../agent-runtime/command-router"
import type { AgentProjectContribution } from "../agent-runtime/project-contributions"
import type { AgentMessage } from "../agent-runtime/types"
import { buildKnowledgeBaseCommandOutput } from "./wiki-command-prompts"

type CreateKnowledgeBaseAgentContributionInput = {
  readonly project: SynapseProjectConfig
}

const KNOWLEDGE_BASE_PUBLISHED_COMMANDS = [
  knowledgeBaseAction("wiki ingest", "汲取来源", "send", "/wiki ingest"),
  knowledgeBaseAction("wiki query", "查询知识库", "insert", "/wiki query "),
  knowledgeBaseAction("wiki hot", "刷新热点", "send", "/wiki hot"),
  knowledgeBaseAction("wiki save", "保存记录", "send", "/wiki save"),
  knowledgeBaseAction("wiki lint", "检查知识库", "send", "/wiki lint"),
  knowledgeBaseAction("wiki status", "查看状态", "send", "/wiki status"),
] as const

export async function createKnowledgeBaseAgentContribution(
  input: CreateKnowledgeBaseAgentContributionInput,
): Promise<AgentProjectContribution | null> {
  if (!await isKnowledgeBaseProject(input.project)) {
    return null
  }

  const bootstrap = await readPrompt("bootstrap.md")
  const hotCachePath = path.join(input.project.path, "wiki", "hot.md")

  return {
    sdkPlugins: [{
      type: "local",
      path: resolveKnowledgeBasePluginPath(),
    }],
    publishedCommands: KNOWLEDGE_BASE_PUBLISHED_COMMANDS,
    commands: [{
      name: "wiki",
      buildPrompt: (args) => buildKnowledgeBaseCommandPrompt(input.project.path, args),
    }],
    async prepareMessage(message, context) {
      if (!context.isNewLiveSession) {
        return message
      }
      const hotCache = await readOptional(hotCachePath)
      return prependBootstrap(message, bootstrap, hotCache)
    },
  }
}

async function isKnowledgeBaseProject(project: SynapseProjectConfig): Promise<boolean> {
  if (project.capabilities?.knowledgeBase?.enabled === true) {
    return true
  }

  return hasKnowledgeBaseMarker(project.path)
}

async function hasKnowledgeBaseMarker(projectPath: string): Promise<boolean> {
  try {
    const content = await readFile(path.join(projectPath, ".synapse-kb.json"), "utf8")
    const parsed = JSON.parse(content) as unknown
    return isKnowledgeBaseMarker(parsed)
  } catch (error) {
    if (isMissingPathError(error) || error instanceof SyntaxError) {
      return false
    }
    throw error
  }
}

function isKnowledgeBaseMarker(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return record.type === "synapse.knowledgeBase" && record.schemaVersion === 1
}

function prependBootstrap(message: AgentMessage, bootstrap: string, hotCache: string): AgentMessage {
  return {
    ...message,
    content: [
      bootstrap.trim(),
      hotCache.trim() ? `Current wiki/hot.md:\n\n${hotCache.trim()}` : "",
      "User message:",
      message.content,
    ].filter(Boolean).join("\n\n---\n\n"),
  }
}

async function buildKnowledgeBaseCommandPrompt(
  projectPath: string,
  args: readonly string[],
): Promise<RegisteredPromptCommandOutput> {
  return buildKnowledgeBaseCommandOutput({
    projectPath,
    args,
    readPrompt,
  })
}

async function readPrompt(fileName: string): Promise<string> {
  const roots = resolvePromptRoots()
  let lastError: unknown
  for (const root of roots) {
    try {
      return await readFile(path.join(root, fileName), "utf8")
    } catch (error) {
      lastError = error
      if (process.env.SYNAPSE_KB_PROMPT_ROOT || !isMissingPathError(error)) {
        throw error
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Knowledge base prompt not found: ${fileName}`)
}

async function readOptional(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error
    }
    return ""
  }
}

function resolvePromptRoots(): readonly string[] {
  if (process.env.SYNAPSE_KB_PROMPT_ROOT) {
    return [process.env.SYNAPSE_KB_PROMPT_ROOT]
  }
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const cwd = path.resolve(process.cwd())
  const desktopRoot = path.basename(cwd) === "desktop" ? cwd : path.join(cwd, "desktop")
  const devRoot = path.join(desktopRoot, "resources", "knowledge-base", "prompts")
  if (resourcesPath) {
    return [path.join(resourcesPath, "knowledge-base", "prompts"), devRoot]
  }
  return [devRoot]
}

function resolveKnowledgeBasePluginPath(): string {
  if (process.env.SYNAPSE_KB_PLUGIN_ROOT) {
    return process.env.SYNAPSE_KB_PLUGIN_ROOT
  }
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const cwd = path.resolve(process.cwd())
  const desktopRoot = path.basename(cwd) === "desktop" ? cwd : path.join(cwd, "desktop")
  const devRoot = path.join(desktopRoot, "resources", "knowledge-base", "claude-plugin")
  if (resourcesPath) {
    return path.join(resourcesPath, "knowledge-base", "claude-plugin")
  }
  return devRoot
}

function knowledgeBaseAction(
  name: string,
  label: string,
  action: "send" | "insert",
  insertText: string,
) {
  return {
    name,
    description: label,
    source: "custom" as const,
    kind: "prompt" as const,
    adminOnly: false,
    ui: {
      group: "knowledge-base" as const,
      label,
      action,
      insertText,
    },
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
