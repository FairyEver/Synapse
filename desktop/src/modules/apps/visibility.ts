import type { SynapseSystemAppDefinition } from "./types"

type SystemAppEntryVisibilityContext = {
  readonly workflowEntryVisible: boolean
}

export function isSystemAppEntryVisible(
  app: SynapseSystemAppDefinition,
  context: SystemAppEntryVisibilityContext,
): boolean {
  return app.visibility !== "workflow-entry-enabled" || context.workflowEntryVisible
}
