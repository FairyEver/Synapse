export const AGENT_REFERENCE_MAX_CODE_POINTS = 4096

export const AGENT_REFERENCE_ACTION_ERROR_CODES = [
  "invalid_reference",
  "foreign_platform_path",
  "project_unavailable",
  "not_found_or_inaccessible",
  "unsupported_object_type",
  "symbolic_link_not_supported",
  "permission_denied",
  "network_timeout",
  "target_changed",
  "no_parent_directory",
  "system_rejected",
  "system_failed",
  "cancelled_before_submission",
] as const

export type AgentReferenceActionErrorCode = typeof AGENT_REFERENCE_ACTION_ERROR_CODES[number]

export type AgentReferenceActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: AgentReferenceActionErrorCode }

export interface AgentReferenceActionInput {
  readonly projectId: string
  readonly reference: string
}
