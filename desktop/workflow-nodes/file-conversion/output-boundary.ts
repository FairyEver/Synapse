import { tmpdir } from "node:os"
import path from "node:path"

const WORKFLOW_FILE_CONVERSION_OUTPUT_ROOT = path.join(tmpdir(), "synapse-workflow-outputs")

export function getWorkflowFileConversionOutputRoot(): string {
  return WORKFLOW_FILE_CONVERSION_OUTPUT_ROOT
}

export function isWorkflowFileConversionOutputPathAllowed(outputPath: string): boolean {
  if (!path.isAbsolute(outputPath)) return false

  const root = path.resolve(WORKFLOW_FILE_CONVERSION_OUTPUT_ROOT)
  const target = path.resolve(outputPath)
  if (target === root) return false

  // There is no broader Workflow file-output contract yet. Until one exists,
  // only absolute paths under this temp-root are accepted by validation/runtime.
  return target.startsWith(`${root}${path.sep}`)
}
