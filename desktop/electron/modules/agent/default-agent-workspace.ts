import { app } from "electron"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"

import {
  DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
  DEFAULT_AGENT_WORKSPACE_PROJECT_NAME,
} from "../../../src/lib/default-agent-workspace"

type DefaultAgentWorkspaceProject = {
  readonly uuid: string
  readonly name: string
  readonly localPath: string
}

function getDefaultAgentWorkspacePath(): string {
  return path.join(app.getPath("userData"), "agent-workspaces", "default")
}

async function resolveDefaultAgentWorkspaceProject(): Promise<DefaultAgentWorkspaceProject> {
  const localPath = getDefaultAgentWorkspacePath()
  await mkdir(localPath, { recursive: true })
  const stats = await stat(localPath)
  if (!stats.isDirectory()) {
    throw Object.assign(
      new Error("Default Agent workspace is not a directory."),
      { code: "ENOTDIR" },
    )
  }
  return {
    uuid: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
    name: DEFAULT_AGENT_WORKSPACE_PROJECT_NAME,
    localPath,
  }
}

export {
  getDefaultAgentWorkspacePath,
  resolveDefaultAgentWorkspaceProject,
  type DefaultAgentWorkspaceProject,
}
