import { realpath, stat } from "node:fs/promises"

export interface WorkflowLocalResourceIdentity {
  readonly identity: string
  readonly isFile: boolean
  readonly isDirectory: boolean
}

export async function resolveWorkflowLocalResourceIdentity(
  resourcePath: string,
): Promise<WorkflowLocalResourceIdentity> {
  const resourceStat = await stat(resourcePath)
  const canonicalPath = await realpath(resourcePath)
  return {
    identity: process.platform === "win32" ? canonicalPath.toLocaleLowerCase() : canonicalPath,
    isFile: resourceStat.isFile(),
    isDirectory: resourceStat.isDirectory(),
  }
}
