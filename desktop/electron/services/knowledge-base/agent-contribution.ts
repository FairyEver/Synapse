import { readFile } from "node:fs/promises"
import path from "node:path"

import type { SynapseProjectConfig } from "../../../src/types/config"
import type { StructuredLogger } from "../../runtime/logging"
import type { RegisteredPromptCommandOutput } from "../agent-runtime/command-router"
import type { AgentProjectContribution } from "../agent-runtime/project-contributions"
import type { AgentMessage } from "../agent-runtime/types"
import { KnowledgeBaseIngestCoordinator, type KnowledgeBaseIngestPreflight } from "./ingest-coordinator"
import { KnowledgeBaseIngestFinalizer } from "./ingest-finalizer"
import { isKnowledgeBaseForceIngestIntent, isKnowledgeBaseIngestIntent } from "./ingest-intent"
import { wikiIngestAppendixCopy, wikiInvalidManifestCopy } from "./wiki-command-copy"
import { buildKnowledgeBaseCommandOutput } from "./wiki-command-prompts"

type CreateKnowledgeBaseAgentContributionInput = {
  readonly project: SynapseProjectConfig
  readonly ingestFinalizer?: Pick<KnowledgeBaseIngestFinalizer, "finalize">
  readonly ingestCoordinator?: Pick<KnowledgeBaseIngestCoordinator, "prepareTurn" | "finalizeTurn">
  readonly logger?: Pick<StructuredLogger, "warn">
}

const KNOWLEDGE_BASE_PUBLISHED_COMMANDS = [
  knowledgeBaseAction("wiki ingest", "汲取来源", "扫描 .raw/ 变更来源并导入到 wiki。", "send", "/wiki ingest"),
  knowledgeBaseAction("wiki query", "查询知识库", "插入查询指令，继续输入要检索的问题。", "insert", "/wiki query "),
  knowledgeBaseAction("wiki hot", "刷新热点", "更新 wiki/hot.md 的近期事实和活跃主题。", "send", "/wiki hot"),
  knowledgeBaseAction("wiki save", "保存记录", "将当前对话要点追加到知识库日志。", "send", "/wiki save"),
  knowledgeBaseAction("wiki lint", "检查知识库", "检查知识库结构、索引和链接状态。", "send", "/wiki lint"),
  knowledgeBaseAction("wiki status", "查看状态", "查看来源清单、页面数量和知识库状态。", "send", "/wiki status"),
] as const

export async function createKnowledgeBaseAgentContribution(
  input: CreateKnowledgeBaseAgentContributionInput,
): Promise<AgentProjectContribution | null> {
  if (!await isKnowledgeBaseProject(input.project)) {
    return null
  }

  const bootstrap = await readPrompt("bootstrap.md")
  const hotCachePath = path.join(input.project.path, "wiki", "hot.md")
  const ingestCoordinator = input.ingestCoordinator ?? new KnowledgeBaseIngestCoordinator({
    ingestFinalizer: input.ingestFinalizer,
  })
  const preflightIdsByMessage = new Map<string, string[]>()

  const rememberPreflight = (message: AgentMessage, preflight: KnowledgeBaseIngestPreflight) => {
    const key = messageKey(message)
    preflightIdsByMessage.set(key, [...(preflightIdsByMessage.get(key) ?? []), preflight.id])
  }

  return {
    sdkPlugins: [{
      type: "local",
      path: resolveKnowledgeBasePluginPath(),
    }],
    publishedCommands: KNOWLEDGE_BASE_PUBLISHED_COMMANDS,
    commands: [{
      name: "wiki",
      buildPrompt: (args, message) => buildKnowledgeBaseCommandPrompt({
        projectPath: input.project.path,
        args,
        ingestCoordinator,
        onIngestPreflight: (preflight) => rememberPreflight(message, preflight),
      }),
    }],
    async prepareMessage(message, context) {
      let next = message
      if (isKnowledgeBaseIngestIntent(message.content) && !hasIngestPreflightAppendix(message.content)) {
        const force = isKnowledgeBaseForceIngestIntent(message.content)
        const preflight = await ingestCoordinator.prepareTurn({ projectPath: input.project.path, force })
        if (preflight.manifest.status === "invalid") {
          next = {
            ...message,
            content: wikiInvalidManifestCopy(preflight.manifest.error),
          }
        } else {
          rememberPreflight(message, preflight)
          next = {
            ...message,
            content: [
              await readPrompt("ingest.md"),
              "",
              message.content,
              "",
              wikiIngestPreflightAppendix(input.project.path, preflight, force),
            ].join("\n"),
          }
        }
      }

      if (!context.isNewLiveSession) {
        return next
      }
      const hotCache = await readOptional(hotCachePath)
      return prependBootstrap(next, bootstrap, hotCache)
    },
    async afterTurn({ message, result }) {
      if (!isKnowledgeBaseIngestIntent(message.content)) return
      const preflightId = takePreflightId(preflightIdsByMessage, message)
      if (result.error) return
      if (!preflightId) return
      const finalizeResult = await ingestCoordinator.finalizeTurn({
        projectPath: input.project.path,
        preflightId,
        assistantText: result.resultText,
      })
      if (finalizeResult.warnings.length > 0) {
        input.logger?.warn("Knowledge base ingest finalization produced warnings.", {
          boundary: "knowledge-base.ingest.finalize",
          projectId: input.project.id,
          warnings: finalizeResult.warnings,
        })
      }
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

async function buildKnowledgeBaseCommandPrompt(input: {
  readonly projectPath: string
  readonly args: readonly string[]
  readonly ingestCoordinator: Pick<KnowledgeBaseIngestCoordinator, "prepareTurn">
  readonly onIngestPreflight: (preflight: KnowledgeBaseIngestPreflight) => void
}): Promise<RegisteredPromptCommandOutput> {
  return buildKnowledgeBaseCommandOutput({
    projectPath: input.projectPath,
    args: input.args,
    readPrompt,
    ingestCoordinator: input.ingestCoordinator,
    onIngestPreflight: input.onIngestPreflight,
  })
}

function wikiIngestPreflightAppendix(
  projectPath: string,
  preflight: KnowledgeBaseIngestPreflight,
  force: boolean,
): string {
  return wikiIngestAppendixCopy({
    projectPath,
    changedSources: preflight.sources.filter((source) => source.state !== "unchanged"),
    skippedSources: preflight.skippedSources,
    force,
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

function messageKey(message: AgentMessage): string {
  return [
    message.projectId,
    message.sessionKey,
    message.platform,
    message.content,
  ].join("\u0000")
}

function takePreflightId(preflightIdsByMessage: Map<string, string[]>, message: AgentMessage): string | null {
  const key = messageKey(message)
  const ids = preflightIdsByMessage.get(key)
  const id = ids?.shift()
  if (!ids || ids.length === 0) {
    preflightIdsByMessage.delete(key)
  }
  return id ?? null
}

function hasIngestPreflightAppendix(content: string): boolean {
  return content.includes("## Synapse 预检") && content.includes("synapse_kb_ingest_report")
}

function knowledgeBaseAction(
  name: string,
  label: string,
  description: string,
  action: "send" | "insert",
  insertText: string,
) {
  return {
    name,
    description,
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
