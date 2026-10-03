import type { TerminalService } from "../../../app-capabilities/terminal/main/service"
import { TerminalContractError } from "../../../app-capabilities/terminal/shared/errors"

/** Read the actual PTY cwd without attaching, controlling or resizing the terminal. */
export async function resolveMobileWorkspaceFilesSession(terminal: Pick<TerminalService, "getSession" | "probeCurrentWorkingDirectory">, sessionId: string): Promise<{ cwd: string; shell: string } | null> {
  try {
    const session = terminal.getSession({ sessionId })
    if (session.status !== "running" && session.status !== "stopping") return null
    const cwd = await terminal.probeCurrentWorkingDirectory(sessionId)
    const current = terminal.getSession({ sessionId })
    if (current.status !== "running" && current.status !== "stopping") return null
    return { cwd, shell: current.shell }
  } catch (error) {
    if (error instanceof TerminalContractError && error.payload.code === "not_found") return null
    throw error
  }
}
