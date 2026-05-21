import { readFile } from "node:fs/promises"
import path from "node:path"

import type { RegisteredPromptCommandOutput } from "../agent-runtime/command-router"
import { scanKnowledgeBaseSources } from "./source-scan"

const QUERY_MODES = new Set(["quick", "deep", "standard"])
const AVAILABLE_COMMANDS = ["/wiki ingest", "/wiki query", "/wiki hot", "/wiki save", "/wiki lint"]

export interface BuildKnowledgeBaseCommandOutputInput {
  readonly projectPath: string
  readonly args: readonly string[]
  readonly readPrompt: (fileName: string) => Promise<string>
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
      return buildIngestOutput(input.projectPath, commandArgs, input.readPrompt)
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
        content: [
          `Unknown /wiki command: ${command}`,
          `Available commands: ${AVAILABLE_COMMANDS.join(", ")}`,
        ].join("\n"),
      }
  }
}

async function buildStatusOutput(projectPath: string): Promise<RegisteredPromptCommandOutput> {
  const scan = await scanKnowledgeBaseSources(projectPath)
  const changedCount = scan.sources.filter((source) => source.state !== "unchanged").length
  return {
    kind: "result",
    content: [
      "Wiki status",
      `Manifest: ${formatManifestStatus(scan.manifest)}`,
      `Sources: ${scan.sources.length}`,
      `Changed: ${changedCount}`,
      `Skipped: ${scan.skippedSources.length}`,
      `Available commands: ${AVAILABLE_COMMANDS.join(", ")}`,
    ].join("\n"),
  }
}

async function buildIngestOutput(
  projectPath: string,
  args: readonly string[],
  readPrompt: (fileName: string) => Promise<string>,
): Promise<RegisteredPromptCommandOutput> {
  const scan = await scanKnowledgeBaseSources(projectPath, { force: args.includes("--force") })
  if (scan.manifest.status === "invalid") {
    return {
      kind: "result",
      error: true,
      content: `Invalid wiki source manifest: ${scan.manifest.error}`,
    }
  }

  const changedSources = scan.sources.filter((source) => source.state !== "unchanged")
  if (changedSources.length === 0) {
    return {
      kind: "result",
      content: [
        "No wiki source changes to ingest.",
        `Sources: ${scan.sources.length}`,
        `Skipped: ${scan.skippedSources.length}`,
      ].join("\n"),
    }
  }

  return {
    kind: "prompt",
    content: [
      await readPrompt("ingest.md"),
      "",
      "Preflight source list:",
      ...changedSources.map((source) => `- ${source.relativePath} (${source.state}, sha256: ${source.hash})`),
      ...(scan.skippedSources.length > 0
        ? ["", "Skipped sources:", ...scan.skippedSources.map((source) => `- ${source.relativePath} (${source.reason})`)]
        : []),
      "",
      "Manifest update requirements:",
      "- Update `.raw/.manifest.json` after processing.",
      "- Keep `version: 1`.",
      "- For each processed source, write the current `hash`, `ingested_at`, `pages_created`, and `pages_updated`.",
      "- Do not change entries for unchanged sources unless they were actually updated.",
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
      `Mode: ${mode}`,
      `Question: ${question || "(not provided)"}`,
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
      "Recent log context:",
      recentLog.trim() || "(none)",
    ].join("\n"),
  }
}

function formatManifestStatus(scan: Awaited<ReturnType<typeof scanKnowledgeBaseSources>>["manifest"]): string {
  if (scan.status === "invalid") {
    return `invalid (${scan.error})`
  }
  return scan.status
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
