import { readFile } from "node:fs/promises"
import path from "node:path"

import type { RegisteredPromptCommandOutput } from "../agent-runtime/command-router"
import { KnowledgeBaseIngestCoordinator, type KnowledgeBaseIngestPreflight } from "./ingest-coordinator"
import { scanKnowledgeBaseSources } from "./source-scan"
import {
  wikiIngestAppendixCopy,
  wikiInvalidManifestCopy,
  wikiNoIngestChangesCopy,
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
  readonly ingestCoordinator?: Pick<KnowledgeBaseIngestCoordinator, "prepareTurn">
  readonly onIngestPreflight?: (preflight: KnowledgeBaseIngestPreflight) => void
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
      return buildIngestOutput(
        input.projectPath,
        commandArgs,
        input.readPrompt,
        input.ingestCoordinator,
        input.onIngestPreflight,
      )
    case "query":
      return buildQueryOutput(commandArgs, input.readPrompt)
    case "hot":
      return buildHotOutput(input.projectPath, input.readPrompt)
    case "save":
      return { kind: "prompt", content: await input.readPrompt("save.md") }
    case "lint":
      return { kind: "prompt", content: await input.readPrompt("lint.md") }
    default:
      return {
        kind: "result",
        error: true,
        content: wikiUnknownCommandCopy(command),
      }
  }
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
  ingestCoordinator: Pick<KnowledgeBaseIngestCoordinator, "prepareTurn"> = new KnowledgeBaseIngestCoordinator(),
  onIngestPreflight?: (preflight: KnowledgeBaseIngestPreflight) => void,
): Promise<RegisteredPromptCommandOutput> {
  const force = args.includes("--force")
  const preflight = await ingestCoordinator.prepareTurn({ projectPath, force })
  if (preflight.manifest.status === "invalid") {
    return {
      kind: "result",
      error: true,
      content: wikiInvalidManifestCopy(preflight.manifest.error),
    }
  }

  const changedSources = preflight.sources.filter((source) => source.state !== "unchanged")
  if (changedSources.length === 0) {
    return {
      kind: "result",
      content: wikiNoIngestChangesCopy({
        sources: preflight.sources.length,
        skipped: preflight.skippedSources.length,
      }),
    }
  }
  onIngestPreflight?.(preflight)

  return {
    kind: "prompt",
    content: [
      await readPrompt("ingest.md"),
      "",
      wikiIngestAppendixCopy({
        projectPath,
        changedSources,
        skippedSources: preflight.skippedSources,
        force,
      }),
    ].join("\n"),
  }
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
