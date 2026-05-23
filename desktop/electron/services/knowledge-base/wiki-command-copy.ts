import type { KnowledgeBaseManifestReadResult } from "./manifest"
import type { KnowledgeBaseSkippedSource, KnowledgeBaseSourceScanItem } from "./source-scan"

export const WIKI_AVAILABLE_COMMANDS = ["/wiki ingest", "/wiki query", "/wiki hot", "/wiki save", "/wiki lint"] as const

export function wikiUnknownCommandCopy(command: string): string {
  return [
    "## 未识别的 Wiki 命令",
    "",
    `命令：\`${command}\``,
    "",
    availableCommandsCopy(),
  ].join("\n")
}

export function wikiStatusCopy(input: {
  readonly manifest: KnowledgeBaseManifestReadResult
  readonly sources: number
  readonly changed: number
  readonly skipped: number
}): string {
  return [
    "## Wiki 状态",
    "",
    `- 清单：${formatManifestStatus(input.manifest)}`,
    `- 来源：${input.sources}`,
    `- 有变更：${input.changed}`,
    `- 已跳过：${input.skipped}`,
    "",
    availableCommandsCopy(),
  ].join("\n")
}

export function wikiInvalidManifestCopy(error: string): string {
  return [
    "## Wiki 来源清单无效",
    "",
    error,
  ].join("\n")
}

export function wikiNoIngestChangesCopy(input: {
  readonly sources: number
  readonly skipped: number
}): string {
  return [
    "## 没有需要导入的来源",
    "",
    `- 来源：${input.sources}`,
    `- 已跳过：${input.skipped}`,
  ].join("\n")
}

export function wikiIngestAppendixCopy(input: {
  readonly projectPath: string
  readonly changedSources: readonly KnowledgeBaseSourceScanItem[]
  readonly skippedSources: readonly KnowledgeBaseSkippedSource[]
}): string {
  return [
    "## 项目目录",
    "",
    `- \`${input.projectPath}\``,
    "- 所有相对路径都以该目录为根；不要使用其他硬编码路径。",
    "",
    "## 预检来源",
    "",
    ...input.changedSources.map((source) =>
      `- \`${source.relativePath}\`（${formatSourceState(source.state)}，sha256：\`${source.hash}\`）`
    ),
    ...(input.skippedSources.length > 0
      ? [
        "",
        "## 已跳过来源",
        "",
        ...input.skippedSources.map((source) =>
          `- \`${source.relativePath}\`（${formatSkippedReason(source.reason)}）`
        ),
      ]
      : []),
    "",
    "## 清单更新要求",
    "",
    "- 处理完成后更新 `.raw/.manifest.json`。",
    "- 使用 claude-obsidian 兼容格式：`version`、`created`、`description`、`sources`、`address_map`。",
    "- `sources` 的 key 使用 `.raw/...`，每个已处理来源都写入当前 `hash`、`ingested_at`、`pages_created`、`pages_updated`。",
    "- `address_map` 记录 wiki 页面路径到稳定地址的映射。",
    "- 未实际更新的来源不要改动对应清单条目。",
  ].join("\n")
}

export function wikiQueryParametersCopy(input: {
  readonly mode: string
  readonly question: string
}): string {
  return [
    "## 查询参数",
    "",
    `- 模式：\`${input.mode}\``,
    `- 问题：${input.question || "（未提供）"}`,
  ].join("\n")
}

export function wikiRecentLogContextCopy(recentLog: string): string {
  return [
    "## 最近日志上下文",
    "",
    recentLog.trim() || "（无）",
  ].join("\n")
}

function availableCommandsCopy(): string {
  return `可用命令：${WIKI_AVAILABLE_COMMANDS.map((command) => `\`${command}\``).join("、")}`
}

function formatManifestStatus(scan: KnowledgeBaseManifestReadResult): string {
  if (scan.status === "invalid") {
    return `无效（${scan.error}）`
  }
  if (scan.status === "valid") {
    return "有效"
  }
  return "缺失"
}

function formatSourceState(state: KnowledgeBaseSourceScanItem["state"]): string {
  switch (state) {
    case "new":
      return "新增"
    case "changed":
      return "已变更"
    case "unchanged":
      return "未变更"
  }
}

function formatSkippedReason(reason: KnowledgeBaseSkippedSource["reason"]): string {
  switch (reason) {
    case "unsupported-extension":
      return "扩展名不支持"
    case "symlink":
      return "符号链接"
    case "read-error":
      return "读取失败"
  }
}
