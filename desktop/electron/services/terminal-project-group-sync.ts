import { stat } from "node:fs/promises"

import type { TerminalService } from "../../app-capabilities/terminal/main/service"
import type { TerminalProjectGroupSource } from "../../app-capabilities/terminal/shared/schema"
import { DEFAULT_AGENT_WORKSPACE_PROJECT } from "../../src/lib/default-agent-workspace"
import type { SynapseProjectConfig } from "../../src/types/config"
import { configStore } from "./config-store"
import { getDefaultAgentWorkspacePath } from "../modules/agent/default-agent-workspace"
import { resolveProjectWorkspacePath } from "./knowledge-base/managed-path"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("terminal.project-groups")

/**
 * The Agent projects, as the terminal needs to hear about them.
 *
 * The local workspace is included even though it lives in no config list: it is a
 * project everywhere the user can see one — the Agent sidebar, the phone's project
 * picker, the ⌘-click shortcut — so a conversation started in it has to land in a
 * group like any other project's.
 *
 * Each one carries the folder it works in, resolved the same way the Agent resolves it
 * (a managed knowledge base lives in its runtime directory, not at its virtual path).
 * A folder that is not there is left out rather than passed on: the group should start
 * terminals somewhere that opens.
 */
export async function terminalProjectGroupSources(
  projects: readonly SynapseProjectConfig[],
): Promise<TerminalProjectGroupSource[]> {
  const entries: Array<{ projectId: string; name: string; path: string }> = [
    {
      projectId: DEFAULT_AGENT_WORKSPACE_PROJECT.id,
      name: DEFAULT_AGENT_WORKSPACE_PROJECT.name,
      path: getDefaultAgentWorkspacePath(),
    },
    ...projects.map((project) => ({
      projectId: project.id,
      name: project.name,
      path: resolveProjectWorkspacePath(project),
    })),
  ]

  return Promise.all(entries.map(async (entry) => {
    const directory = await stat(entry.path).then((stats) => stats.isDirectory()).catch(() => false)
    return directory
      ? entry
      : { projectId: entry.projectId, name: entry.name }
  }))
}

/**
 * Makes the terminal's project groups match the projects that exist right now.
 *
 * Called from where the project list changes — settings saving it, a backup replacing
 * it — and once at startup, which is also what gives every project that existed before
 * the terminal knew about projects its group.
 */
export async function syncTerminalProjectGroups(terminal: TerminalService): Promise<void> {
  const config = await configStore.load()
  await terminal.syncProjectGroups(await terminalProjectGroupSources(config.global.projects))
}

/**
 * The same, for callers that must not fail because the terminal could not follow.
 *
 * Saving a project list is the user's action and its own outcome; a terminal that could
 * not keep up is worth a line in the log and nothing else.
 */
export async function syncTerminalProjectGroupsSafely(
  resolveTerminal: () => TerminalService,
  source: string,
): Promise<void> {
  try {
    await syncTerminalProjectGroups(resolveTerminal())
  } catch (error) {
    logger.warn("Failed to sync terminal project groups.", {
      source,
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: String(error).length,
    })
  }
}
