import type {
  DispatchContext,
  DispatchResult,
} from "../../../synapse-capabilities/shared/types"
import { PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID } from "../shared/capability"
import type { ProblemFeedbackService } from "./service"

const sharedProblemFeedbackPromise = import("@synapse/shared")

const messages = {
  INVALID_INPUT: "问题反馈内容不符合提交要求。",
  PRIVACY_RISK: "问题反馈包含不允许提交的隐私风险。",
  RATE_LIMITED: "问题反馈提交过于频繁。",
  SUBMISSION_FAILED: "问题反馈未提交。",
  SUBMISSION_OUTCOME_UNKNOWN: "问题反馈提交结果未知，内容可能已经提交。",
} as const

export function createProblemFeedbackCapabilityDispatcher(deps: {
  readonly service: Pick<ProblemFeedbackService, "submit">
}) {
  return {
    async dispatch(
      action: string,
      params: Record<string, unknown>,
      context: DispatchContext,
    ): Promise<DispatchResult> {
      if (action !== PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID) {
        throw new Error(`Unknown problem feedback action: ${action}`)
      }
      if (context.source !== "mcp-http" && context.source !== "mcp-stdio") {
        throw new Error("Problem feedback entry requires a trusted MCP source.")
      }

      const { validateProblemFeedbackInput } = await sharedProblemFeedbackPromise
      const validation = validateProblemFeedbackInput(params)
      if (!validation.ok) {
        return {
          ok: false,
          code: validation.code,
          error: messages[validation.code],
          data: validation.data,
        }
      }
      const result = await deps.service.submit(validation.data.content, context.abortSignal)
      if (result.ok) return result
      return {
        ok: false,
        code: result.code,
        error: messages[result.code],
        ...(result.data ? { data: result.data } : {}),
      }
    },
  }
}
