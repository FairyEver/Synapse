import { DragonScaleBoundaryService } from "./dragonscale/boundary-service"

export interface KnowledgeBaseResearchCandidate {
  readonly title: string
  readonly path: string
  readonly score: number
  readonly outDegree: number
  readonly inDegree: number
}

export type KnowledgeBaseResearchPreflightResult =
  | { readonly mode: "explicit-topic"; readonly topic: string }
  | { readonly mode: "boundary-candidates"; readonly candidates: readonly KnowledgeBaseResearchCandidate[] }
  | { readonly mode: "needs-topic"; readonly reason?: string }

type KnowledgeBaseResearchPreflightDeps = {
  readonly boundaryService?: Pick<DragonScaleBoundaryService, "score">
}

export class KnowledgeBaseResearchPreflightService {
  private readonly boundaryService: Pick<DragonScaleBoundaryService, "score">

  constructor(deps: KnowledgeBaseResearchPreflightDeps = {}) {
    this.boundaryService = deps.boundaryService ?? new DragonScaleBoundaryService()
  }

  async prepare(projectPath: string, topic: string): Promise<KnowledgeBaseResearchPreflightResult> {
    const trimmed = topic.trim()
    if (trimmed) {
      return { mode: "explicit-topic", topic: trimmed }
    }
    try {
      const report = await this.boundaryService.score(projectPath, { top: 5 })
      if (report.results.length === 0) {
        return { mode: "needs-topic", reason: "No boundary candidates are available." }
      }
      return {
        mode: "boundary-candidates",
        candidates: report.results.slice(0, 5).map((result) => ({
          title: result.title,
          path: result.path,
          score: result.score,
          outDegree: result.outDegree,
          inDegree: result.inDegree,
        })),
      }
    } catch (error) {
      return {
        mode: "needs-topic",
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

export function formatKnowledgeBaseResearchAppendix(result: KnowledgeBaseResearchPreflightResult): string {
  if (result.mode === "explicit-topic") {
    return [
      "## Research Topic",
      "",
      `- Topic: ${result.topic}`,
      "- Use this topic directly.",
    ].join("\n")
  }
  if (result.mode === "needs-topic") {
    return [
      "## Research Topic",
      "",
      "- No explicit topic was provided.",
      result.reason ? `- Boundary-first selection unavailable: ${result.reason}` : "- Boundary-first selection unavailable.",
      "- Ask the user what topic should be researched.",
    ].join("\n")
  }
  return [
    "## Boundary-First Research Candidates",
    "",
    "- The following candidates were computed by Synapse internal DragonScale boundary scoring.",
    "- Ask the user to choose one, type an override topic, or cancel.",
    "",
    ...result.candidates.map((candidate, index) =>
      `${index + 1}. ${candidate.title} (${candidate.path}) score=${candidate.score}; out=${candidate.outDegree}; in=${candidate.inDegree}`),
  ].join("\n")
}
