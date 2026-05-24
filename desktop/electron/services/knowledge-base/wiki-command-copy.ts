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
  readonly force: boolean
}): string {
  return [
    "## Synapse 预检",
    "",
    "## 项目目录",
    "",
    `- \`${input.projectPath}\``,
    "- 所有相对路径都以该目录为根；不要使用其他硬编码路径。",
    ...(input.force
      ? [
        "",
        "## 强制导入",
        "",
        "- 本次使用 `/wiki ingest --force`；预检已将支持的来源纳入本回合处理范围。",
      ]
      : []),
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
    "## 清单写入边界",
    "",
    "- Agent 不要编辑 `.raw/.manifest.json`。",
    "- Synapse 会根据本回合报告写入 `.raw/.manifest.json` 的 `sources` 和 `address_map`。",
    "- Synapse 会在导入回合结束后补齐 DragonScale 地址并更新 `address_map`。",
    "- 不要编辑 `.vault-meta/address-counter.txt`；地址计数器由 Synapse 内部服务维护。",
    "- 如果重写已有页面，保留页面中已有的 `address:` frontmatter。",
    "",
    "## 回合报告要求",
    "",
    "- 回复必须包含且只包含一个 `synapse_kb_ingest_report` fenced JSON block。",
    "- `processed_sources[].source` 只能使用上方预检来源中的 `.raw/...` 路径。",
    "- `pages_created` 和 `pages_updated` 只能列出本回合实际创建或更新的 `wiki/**/*.md` 文件。",
    "",
    "```json synapse_kb_ingest_report",
    "{",
    '  "schema": "synapse.kb.ingest.report.v1",',
    '  "processed_sources": [',
    "    {",
    '      "source": ".raw/example.md",',
    '      "pages_created": ["wiki/sources/example.md"],',
    '      "pages_updated": ["wiki/index.md", "wiki/hot.md"]',
    "    }",
    "  ],",
    '  "skipped_sources": [',
    "    {",
    '      "source": ".raw/ignored.md",',
    '      "reason": "brief reason"',
    "    }",
    "  ]",
    "}",
    "```",
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
