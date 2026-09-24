import { z } from "zod"

import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { TerminalGitService } from "../../../electron/services/terminal-git/terminal-git-service"
import type { TerminalGitLineStats, TerminalGitSnapshot } from "../../../electron/services/terminal-git/terminal-git-types"
import {
  terminalGitStatusSchema,
  terminalGitSyncInputSchema,
  terminalGitSyncResultSchema,
  terminalSessionIdInputSchema,
  type TerminalGitStatus,
} from "../shared/schema"
import type { TerminalService } from "./service"

function visibleStatus(snapshot: TerminalGitSnapshot, lineStats: TerminalGitLineStats): TerminalGitStatus {
  const { cwd, isRepository, branch, detachedSha, upstream, ahead, behind, changeCount, hasConflicts } = snapshot
  return { cwd, isRepository, branch, detachedSha, upstream, ahead, behind, changeCount, ...lineStats, hasConflicts }
}

export const terminalGitMethods: IpcModule["methods"] = {
  getGitStatus: {
    operationId: "app.terminal.git.status",
    kind: "invoke",
    request: terminalSessionIdInputSchema,
    response: terminalGitStatusSchema,
    handler: async (ctx, request: z.infer<typeof terminalSessionIdInputSchema>) => {
      const terminal = ctx.resolve<TerminalService>("core.terminal")
      const git = ctx.resolve<TerminalGitService>("terminal.git-service")
      const cwd = await terminal.probeCurrentWorkingDirectory(request.sessionId)
      const snapshot = await git.getSnapshot(cwd)
      return visibleStatus(snapshot, await git.getLineStats(snapshot))
    },
  },
  syncGit: {
    operationId: "app.terminal.git.sync",
    kind: "invoke",
    request: terminalGitSyncInputSchema,
    response: terminalGitSyncResultSchema,
    handler: async (ctx, request: z.infer<typeof terminalGitSyncInputSchema>) => {
      const terminal = ctx.resolve<TerminalService>("core.terminal")
      const git = ctx.resolve<TerminalGitService>("terminal.git-service")
      const cwd = await terminal.probeCurrentWorkingDirectory(request.sessionId)
      if (cwd !== request.expectedCwd) {
        return { ok: false as const, message: "终端目录已变化，请刷新后重试。" }
      }
      const result = await git.sync({ cwd })
      return result.ok
        ? { ok: true as const, status: visibleStatus(result.value, await git.getLineStats(result.value)) }
        : { ok: false as const, message: result.message }
    },
  },
}
