import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

import type { SynapseProjectConfig } from "../../../src/types/config"
import type { RegisteredPromptCommandOutput } from "../agent-runtime/command-router"
import type {
  AgentProjectContribution,
  AgentSdkSubagentToolPolicies,
} from "../agent-runtime/project-contributions"
import type { AgentMessage } from "../agent-runtime/types"
import { KnowledgeBaseIngestFinalizer } from "./ingest-finalizer"
import { KnowledgeBaseIngestCoordinator } from "./ingest-coordinator"
import { KnowledgeBaseHotCacheStateStore } from "./hot-cache-state"
import type { KnowledgeBaseIngestTurnStore } from "./ingest-turn-store"
import { readKnowledgeBaseManifest } from "./manifest"
import type { KnowledgeBaseParallelIngestRunner } from "./parallel-ingest-runner"
import { KnowledgeBaseResearchCoordinator } from "./research-coordinator"
import {
  KNOWLEDGE_BASE_INGEST_WORKER_AGENT_NAME,
  knowledgeBaseIngestWorkerAgents,
} from "./ingest-worker-agent"
import {
  isKnowledgeBaseForceIngestIntent,
  isKnowledgeBaseResearchWriteIntent,
  isKnowledgeBaseSourceIngestIntent,
} from "./ingest-intent"
import { buildKnowledgeBaseCommandOutput } from "./wiki-command-prompts"

type CreateKnowledgeBaseAgentContributionInput = {
  readonly project: SynapseProjectConfig
  readonly ingestCoordinator?: KnowledgeBaseIngestCoordinator
  readonly ingestTurnStore?: KnowledgeBaseIngestTurnStore
  readonly hotCacheStateStore?: KnowledgeBaseHotCacheStateStore
  readonly hotCacheStaleAfterMs?: number
  readonly nowMs?: () => number
  readonly addressFinalizer?: Pick<KnowledgeBaseIngestFinalizer, "finalize">
  readonly researchCoordinator?: Pick<KnowledgeBaseResearchCoordinator, "prepareTurn" | "finalizeTurn">
  readonly parallelIngestRunner?: Pick<KnowledgeBaseParallelIngestRunner, "prepareMergePrompt">
  readonly parallelIngestSourceThreshold?: number
  readonly logger?: { warn(message: string, metadata?: Record<string, unknown>): void }
}

const KNOWLEDGE_BASE_PUBLISHED_COMMANDS = [
  knowledgeBaseAction("wiki ingest", "汲取来源", "扫描 .raw/ 变更来源并导入到 wiki。", "send", "/wiki ingest"),
  knowledgeBaseAction("wiki query", "查询知识库", "插入查询指令，继续输入要检索的问题。", "insert", "/wiki query "),
  knowledgeBaseAction("wiki hot", "刷新热点", "更新 wiki/hot.md 的近期事实和活跃主题。", "send", "/wiki hot"),
  knowledgeBaseAction("wiki save", "保存记录", "将当前对话要点追加到知识库日志。", "send", "/wiki save"),
  knowledgeBaseAction("wiki lint", "检查知识库", "检查知识库结构、索引和链接状态。", "send", "/wiki lint"),
  knowledgeBaseAction("wiki research", "研究入库", "研究一个主题并将结果归档到知识库。", "insert", "/wiki research "),
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
    readPrompt,
    store: input.ingestTurnStore,
    logger: input.logger,
  })
  const hotCacheStateStore = input.hotCacheStateStore ?? new KnowledgeBaseHotCacheStateStore()
  const hotCacheStaleAfterMs = input.hotCacheStaleAfterMs ?? 4 * 60 * 60 * 1000
  const nowMs = input.nowMs ?? (() => Date.now())
  const addressFinalizer = input.addressFinalizer ?? new KnowledgeBaseIngestFinalizer()
  const researchCoordinator = input.researchCoordinator ?? new KnowledgeBaseResearchCoordinator({
    readPrompt,
    addressFinalizer,
  })
  const parallelIngestSourceThreshold = input.parallelIngestSourceThreshold ?? 4

  return {
    sdkPlugins(message) {
      return isKnowledgeBaseAgentMessage(message)
        ? [{
          type: "local",
          path: resolveKnowledgeBasePluginPath(),
        }]
        : []
    },
    sdkAgents(message) {
      return isKnowledgeBaseAgentMessage(message) ? knowledgeBaseIngestWorkerAgents() : {}
    },
    sdkSubagentToolPolicies(message): AgentSdkSubagentToolPolicies {
      if (!isKnowledgeBaseAgentMessage(message)) return {}
      const policies: AgentSdkSubagentToolPolicies = {
        [KNOWLEDGE_BASE_INGEST_WORKER_AGENT_NAME]: {
          allowedWriteRoots: ["wiki/sources"],
          deniedWritePaths: [
            ".raw/.manifest.json",
            ".vault-meta",
            "wiki/index.md",
            "wiki/hot.md",
            "wiki/log.md",
            "wiki/concepts",
            "wiki/entities",
            "wiki/questions",
          ],
        },
      }
      return policies
    },
    publishedCommands: KNOWLEDGE_BASE_PUBLISHED_COMMANDS.map((command) => ({
      ...command,
      allowedPlatforms: ["local-renderer"],
    })),
    commands: [{
      name: "wiki",
      allowedPlatforms: ["local-renderer"],
      buildPrompt: (args, message, context) => {
        if (!isKnowledgeBaseAgentMessage(message)) {
          return { kind: "result", error: true, content: "知识库命令只在本地知识库对话中可用。" }
        }
        return buildKnowledgeBaseCommandPrompt(input.project.path, args, context?.turnId ?? "wiki-command", ingestCoordinator, researchCoordinator)
      },
    }],
    async prepareMessage(message, context) {
      if (!isKnowledgeBaseAgentMessage(message)) return message
      let next = message
      const hotCache = await readOptional(hotCachePath)
      const hotHash = hashHotCache(hotCache)
      const shouldInjectHotCache = context.isNewLiveSession || await hotCacheStateStore.shouldInject({
        conversationId: context.conversationId,
        hotHash,
        nowMs: nowMs(),
        staleAfterMs: hotCacheStaleAfterMs,
      })
      if (shouldInjectHotCache) {
        await hotCacheStateStore.markInjected({
          conversationId: context.conversationId,
          hotHash,
          injectedAtMs: nowMs(),
        })
        next = prependBootstrap(message, bootstrap, hotCache)
      }
      if (isKnowledgeBaseSourceIngestIntent(message.content) && !/^\/wiki\s+/i.test(message.content.trim())) {
        const output = await ingestCoordinator.prepareTurn({
          projectPath: input.project.path,
          turnId: context.turnId,
          originalContent: message.content,
          force: isKnowledgeBaseForceIngestIntent(message.content),
        })
        if (typeof output !== "string" && output.kind === "result") {
          await ingestCoordinator.markTurnNoFinalize(context.turnId)
        }
        let content = typeof output === "string" ? output : output.content
        if (typeof output !== "string"
          && output.kind === "prompt"
          && input.parallelIngestRunner) {
          const preflight = await ingestCoordinator.getPreflightState(context.turnId)
          if (preflight && preflight.changedSources.length >= parallelIngestSourceThreshold) {
            const manifest = await readKnowledgeBaseManifest(input.project.path)
            const parallel = await input.parallelIngestRunner.prepareMergePrompt({
              projectId: message.projectId,
              projectPath: input.project.path,
              conversationId: context.conversationId,
              turnId: context.turnId,
              userId: message.userId,
              preflight,
              manifestSources: manifest.manifest.sources,
            })
            if (parallel.status === "merge-ready") {
              content = parallel.prompt
            } else {
              await ingestCoordinator.markTurnNoFinalize(context.turnId)
              content = parallel.message
            }
          }
        }
        return shouldInjectHotCache
          ? prependBootstrap(message, bootstrap, hotCache, content)
          : { ...next, content }
      }
      return next
    },
    async afterTurn({ message, result, conversationId, turnId }) {
      if (!isKnowledgeBaseAgentMessage(message)) return
      if (result.error) return
      if (isKnowledgeBaseSourceIngestIntent(message.content)) {
        const finalizeResult = await ingestCoordinator.finalizeTurn({
          projectPath: input.project.path,
          conversationId,
          turnId,
          assistantText: result.resultText,
        })
        return eventsForKnowledgeBaseFinalizeMessage(finalizeResult?.message)
      }
      if (isKnowledgeBaseResearchWriteIntent(message.content)) {
        const finalizeResult = await researchCoordinator.finalizeTurn({
          projectPath: input.project.path,
          assistantText: result.resultText,
        })
        return eventsForKnowledgeBaseFinalizeMessage(finalizeResult.message)
      }
    },
  }
}

function hashHotCache(content: string): string {
  return createHash("sha256").update(content).digest("hex")
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

function prependBootstrap(message: AgentMessage, bootstrap: string, hotCache: string, content = message.content): AgentMessage {
  return {
    ...message,
    content: [
      bootstrap.trim(),
      hotCache.trim() ? `Current wiki/hot.md:\n\n${hotCache.trim()}` : "",
      "User message:",
      content,
    ].filter(Boolean).join("\n\n---\n\n"),
  }
}

async function buildKnowledgeBaseCommandPrompt(
  projectPath: string,
  args: readonly string[],
  turnId: string,
  ingestCoordinator: Pick<KnowledgeBaseIngestCoordinator, "prepareTurn">,
  researchCoordinator: Pick<KnowledgeBaseResearchCoordinator, "prepareTurn">,
): Promise<RegisteredPromptCommandOutput> {
  return buildKnowledgeBaseCommandOutput({
    projectPath,
    args,
    turnId,
    ingestCoordinator,
    researchCoordinator,
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

function isKnowledgeBaseAgentMessage(message: AgentMessage): boolean {
  return message.platform === "local-renderer"
}

function eventsForKnowledgeBaseFinalizeMessage(message: string | undefined) {
  return message
    ? {
      events: [{
        type: "error" as const,
        message,
        timestamp: new Date().toISOString(),
      }],
    }
    : { events: [] }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
