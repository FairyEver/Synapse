import type { KnowledgeBaseManifestReadResult } from "./manifest"
import type { KnowledgeBaseSkippedSource, KnowledgeBaseSourceScanItem } from "./source-scan"

export const WIKI_AVAILABLE_COMMANDS = [
  "/wiki ingest",
  "/wiki query",
  "/wiki hot",
  "/wiki save",
  "/wiki lint",
  "/wiki research",
] as const

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
    "- 不要编辑 `.raw/.manifest.json`；Synapse 会根据预检 hash 和 `synapse_kb_ingest_report` 写入 manifest。",
    "- 最后必须输出 `synapse_kb_ingest_report` fenced JSON block，包含 `schema`、`processed_sources`、`pages_created`、`pages_updated`。",
    "- `processed_sources[].source` 必须来自上方预检来源列表。",
    "- 不要编辑 `.vault-meta/address-counter.txt`；地址计数器由 Synapse 内部服务维护。",
    "- 如果重写已有页面，保留页面中已有的 `address:` frontmatter。",
    "- 不要自行写入 hash、`ingested_at`、`address_map` 或 DragonScale 地址。",
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

export function wikiLintReportInstructionsCopy(date: string): string {
  return [
    "## Lint 输出要求",
    "",
    `- 将最终报告写入 \`wiki/meta/lint-report-${date}.md\`。`,
    "- 使用上方 Synapse 确定性预检作为事实来源。",
    "- 可以补充 stale claims、missing concepts、cross-reference gaps 等语义判断。",
    "- 不要运行或引用用户 vault 中的 DragonScale 脚本；这些脚本不应存在。",
  ].join("\n")
}

export function wikiResearchFinalizerCopy(mode: "explicit-topic" | "boundary-candidates" | "needs-topic"): string {
  return [
    "## Research 写入要求",
    "",
    "- 研究结果写入 `wiki/sources/`、`wiki/concepts/`、`wiki/entities/` 和 `wiki/questions/`。",
    "- 更新 `wiki/index.md`、`wiki/hot.md` 和 `wiki/log.md`。",
    "- 保留已有页面的 `address:` frontmatter；新页面地址由 Synapse 后置 finalizer 补齐。",
    mode === "boundary-candidates"
      ? "- 这是 topic-selection 回合：先让用户选择候选或输入覆盖 topic，不要直接开始大规模写入。"
      : "- 如果已经有明确 topic，可以开始研究并归档结果。",
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
