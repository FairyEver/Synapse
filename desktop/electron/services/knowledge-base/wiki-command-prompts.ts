import { readFile } from "node:fs/promises"
import path from "node:path"

import type { RegisteredPromptCommandOutput } from "../agent-runtime/command-router"
import { KnowledgeBaseLintPreflightService } from "./lint-preflight"
import type { KnowledgeBaseLintPreflightResult } from "./lint-preflight"
import { formatKnowledgeBaseLintPreflightAppendix } from "./lint-preflight"
import { KnowledgeBaseIngestCoordinator } from "./ingest-coordinator"
import { KnowledgeBaseResearchCoordinator } from "./research-coordinator"
import { KnowledgeBaseResearchPreflightService } from "./research-preflight"
import { scanKnowledgeBaseSources } from "./source-scan"
import {
  wikiLintReportInstructionsCopy,
  wikiQueryParametersCopy,
  wikiRecentLogContextCopy,
  wikiStatusCopy,
  wikiUnknownCommandCopy,
} from "./wiki-command-copy"

const QUERY_MODES = new Set(["quick", "deep", "standard"])

export interface BuildKnowledgeBaseCommandOutputInput {
  readonly projectPath: string
  readonly args: readonly string[]
  readonly readPrompt: (fileName: string) => Promise<string>
  readonly turnId?: string
  readonly ingestCoordinator?: Pick<KnowledgeBaseIngestCoordinator, "prepareTurn">
  readonly lintPreflight?: Pick<KnowledgeBaseLintPreflightService, "run">
  readonly researchPreflight?: Pick<KnowledgeBaseResearchPreflightService, "prepare">
  readonly researchCoordinator?: Pick<KnowledgeBaseResearchCoordinator, "prepareTurn">
}

export async function buildKnowledgeBaseCommandOutput(
  input: BuildKnowledgeBaseCommandOutputInput,
): Promise<RegisteredPromptCommandOutput> {
  const command = (input.args[0] ?? "status").toLowerCase()
  const commandArgs = input.args.slice(1)

  switch (command) {
    case "status":
      return buildStatusOutput(input.projectPath)
    case "ingest":
      return buildIngestOutput(input.projectPath, commandArgs, input.readPrompt, input.turnId, input.ingestCoordinator)
    case "query":
      return buildQueryOutput(commandArgs, input.readPrompt)
    case "hot":
      return buildHotOutput(input.projectPath, input.readPrompt)
    case "save":
      return { kind: "prompt", content: await input.readPrompt("save.md") }
    case "lint":
      return buildLintOutput(input.projectPath, input.readPrompt, input.lintPreflight)
    case "research":
      return buildResearchOutput(input.projectPath, commandArgs, input.readPrompt, input.researchPreflight, input.researchCoordinator)
    default:
      return {
        kind: "result",
        error: true,
        content: wikiUnknownCommandCopy(command),
      }
  }
}

async function buildLintOutput(
  projectPath: string,
  readPrompt: (fileName: string) => Promise<string>,
  lintPreflight?: Pick<KnowledgeBaseLintPreflightService, "run">,
): Promise<RegisteredPromptCommandOutput> {
  const preflight = await (lintPreflight ?? new KnowledgeBaseLintPreflightService()).run(projectPath)
  return {
    kind: "prompt",
    content: [
      await readPrompt("lint.md"),
      "",
      formatKnowledgeBaseLintPreflightAppendix(preflight as KnowledgeBaseLintPreflightResult),
      "",
      wikiLintReportInstructionsCopy(preflight.generatedDate),
    ].join("\n"),
  }
}

async function buildResearchOutput(
  projectPath: string,
  args: readonly string[],
  readPrompt: (fileName: string) => Promise<string>,
  researchPreflight?: Pick<KnowledgeBaseResearchPreflightService, "prepare">,
  researchCoordinator?: Pick<KnowledgeBaseResearchCoordinator, "prepareTurn">,
): Promise<RegisteredPromptCommandOutput> {
  return (researchCoordinator ?? new KnowledgeBaseResearchCoordinator({ readPrompt, researchPreflight }))
    .prepareTurn({ projectPath, args })
}

async function buildStatusOutput(projectPath: string): Promise<RegisteredPromptCommandOutput> {
  const scan = await scanKnowledgeBaseSources(projectPath)
  const changedCount = scan.sources.filter((source) => source.state !== "unchanged").length
  return {
    kind: "result",
    content: wikiStatusCopy({
      manifest: scan.manifest,
      sources: scan.sources.length,
      changed: changedCount,
      skipped: scan.skippedSources.length,
    }),
  }
}

async function buildIngestOutput(
  projectPath: string,
  args: readonly string[],
  readPrompt: (fileName: string) => Promise<string>,
  turnId: string | undefined,
  ingestCoordinator: Pick<KnowledgeBaseIngestCoordinator, "prepareTurn"> | undefined,
): Promise<RegisteredPromptCommandOutput> {
  return (ingestCoordinator ?? new KnowledgeBaseIngestCoordinator({ readPrompt })).prepareTurn({
    projectPath,
    turnId: turnId ?? "wiki-command",
    originalContent: `/wiki ingest ${args.join(" ")}`.trim(),
    force: args.includes("--force"),
  })
}

async function buildQueryOutput(
  args: readonly string[],
  readPrompt: (fileName: string) => Promise<string>,
): Promise<RegisteredPromptCommandOutput> {
  const firstArg = args[0]?.toLowerCase()
  const hasExplicitMode = firstArg ? QUERY_MODES.has(firstArg) : false
  const mode = hasExplicitMode ? firstArg ?? "standard" : "standard"
  const question = (hasExplicitMode ? args.slice(1) : args).join(" ").trim()

  return {
    kind: "prompt",
    content: [
      await readPrompt("query.md"),
      "",
      wikiQueryParametersCopy({ mode, question }),
    ].join("\n"),
  }
}

async function buildHotOutput(
  projectPath: string,
  readPrompt: (fileName: string) => Promise<string>,
): Promise<RegisteredPromptCommandOutput> {
  const recentLog = await readOptional(path.join(projectPath, "wiki", "log.md"))
  return {
    kind: "prompt",
    content: [
      await readPrompt("hot-cache.md"),
      "",
      wikiRecentLogContextCopy(recentLog),
    ].join("\n"),
  }
}

async function readOptional(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    if (isMissingPathError(error)) {
      return ""
    }
    throw error
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
