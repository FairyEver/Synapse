import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const PROBLEM_FEEDBACK_APP_ID = "problem-feedback" as const
export const PROBLEM_FEEDBACK_NAMESPACE = "problem_feedback" as const
export const PROBLEM_FEEDBACK_SERVICE_ID = "core.problem-feedback" as const
export const PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID =
  "app.problem_feedback.report.submit" as CapabilityId
export const PROBLEM_FEEDBACK_SUBMIT_MCP_TOOL_NAME =
  "app_problem_feedback_report_submit" as const
export const PROBLEM_FEEDBACK_CAPABILITY_VERSION = "1.0.0" as const
