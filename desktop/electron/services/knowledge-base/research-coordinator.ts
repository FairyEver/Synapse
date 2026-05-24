import type { RegisteredPromptCommandOutput } from "../agent-runtime/command-router"
import { KnowledgeBaseIngestFinalizer } from "./ingest-finalizer"
import { KnowledgeBaseResearchPreflightService, formatKnowledgeBaseResearchAppendix } from "./research-preflight"
import { KNOWLEDGE_BASE_RESEARCH_REPORT_SCHEMA, parseKnowledgeBaseResearchReport } from "./research-report"

type AddressFinalizerLike = Pick<KnowledgeBaseIngestFinalizer, "finalize">

export class KnowledgeBaseResearchCoordinator {
  private readonly readPrompt: (fileName: string) => Promise<string>
  private readonly researchPreflight: Pick<KnowledgeBaseResearchPreflightService, "prepare">
  private readonly addressFinalizer: AddressFinalizerLike

  constructor(deps: {
    readonly readPrompt: (fileName: string) => Promise<string>
    readonly researchPreflight?: Pick<KnowledgeBaseResearchPreflightService, "prepare">
    readonly addressFinalizer?: AddressFinalizerLike
  }) {
    this.readPrompt = deps.readPrompt
    this.researchPreflight = deps.researchPreflight ?? new KnowledgeBaseResearchPreflightService()
    this.addressFinalizer = deps.addressFinalizer ?? new KnowledgeBaseIngestFinalizer()
  }

  async prepareTurn(input: { readonly projectPath: string; readonly args: readonly string[] }): Promise<RegisteredPromptCommandOutput> {
    const topic = input.args.join(" ").trim()
    const preflight = await this.researchPreflight.prepare(input.projectPath, topic)
    return {
      kind: "prompt",
      content: [
        await this.readPrompt("research.md"),
        "",
        formatKnowledgeBaseResearchAppendix(preflight),
        "",
        researchLoopContractCopy(),
        "",
        researchReportContractCopy(),
      ].join("\n"),
    }
  }

  async finalizeTurn(input: { readonly projectPath: string; readonly assistantText: string }): Promise<{
    readonly status: "finalized" | "skipped"
    readonly message?: string
  }> {
    const parsed = parseKnowledgeBaseResearchReport(input.assistantText)
    if (parsed.status !== "valid") {
      return { status: "skipped", message: "知识库研究后置写入未完成：缺少有效 synapse_kb_research_report。" }
    }
    const result = await this.addressFinalizer.finalize(input.projectPath)
    return result.skippedReason
      ? { status: "skipped", message: "知识库研究后置写入未完成：manifest 无效。" }
      : { status: "finalized" }
  }
}

function researchLoopContractCopy(): string {
  return [
    "## Research Loop Contract",
    "",
    "- Max rounds: 3",
    "- Round 1: broad search across 3-5 angles.",
    "- Round 2: gap fill based on missing or contradictory findings.",
    "- Round 3: optional contradiction or synthesis check.",
    "- Use WebSearch and WebFetch only through the active Agent permission flow.",
    "- File results into wiki pages; do not return only a chat answer.",
    "- 新页面地址由 Synapse 后置 finalizer 补齐；不要手动发明 `address:`。",
  ].join("\n")
}

function researchReportContractCopy(): string {
  return [
    "最后必须输出一个 `synapse_kb_research_report` fenced JSON block。",
    "```synapse_kb_research_report",
    JSON.stringify({
      schema: KNOWLEDGE_BASE_RESEARCH_REPORT_SCHEMA,
      topic: "Example topic",
      rounds: 2,
      searches: 8,
      pages_created: ["wiki/questions/Research - Example topic.md"],
      pages_updated: ["wiki/index.md", "wiki/hot.md", "wiki/log.md"],
      sources: ["wiki/sources/Example source.md"],
    }, null, 2),
    "```",
  ].join("\n")
}
