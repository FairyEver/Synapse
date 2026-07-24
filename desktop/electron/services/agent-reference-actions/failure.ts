import type { AgentReferenceActionErrorCode } from "../../../src/types/agent-reference-action"

export class AgentReferenceActionFailure extends Error {
  constructor(
    readonly code: AgentReferenceActionErrorCode,
    readonly stage: string,
  ) {
    super(code)
    this.name = "AgentReferenceActionFailure"
  }
}
