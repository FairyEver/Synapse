import { z } from "zod"

import type { IpcHandlerContext, IpcModule } from "../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../electron/runtime/window"
import {
  WORKSPACE_FILE_TREE_SERVICE_ID,
  type WorkspaceFileTreeService,
} from "../../../electron/services/workspace-file-tree-service"
import {
  workspaceFileTreeChangedEventSchema,
  workspaceFileTreeDirectoryResultSchema,
  workspaceFileTreeListInputSchema,
  workspaceFileTreeResolvePathsInputSchema,
  workspaceFileTreeResolvePathsResultSchema,
  workspaceFileTreeScopeIdInputSchema,
  workspaceFileTreeScopeSchema,
} from "../../../electron/services/workspace-file-tree-schema"
import { ipcOperationIdToChannel } from "../../../synapse-capabilities/shared/naming"
import { terminalSessionIdInputSchema } from "../shared/schema"
import type { TerminalService } from "./service"

const wiredServices = new WeakSet<WorkspaceFileTreeService>()
const observedOwners = new WeakMap<WorkspaceFileTreeService, Set<number>>()

export const terminalWorkspaceTreeMethods: IpcModule["methods"] = {
  openWorkspaceTree: {
    operationId: "app.terminal.workspace_tree.open",
    kind: "invoke",
    request: terminalSessionIdInputSchema,
    response: workspaceFileTreeScopeSchema,
    handler: (ctx, request: z.infer<typeof terminalSessionIdInputSchema>) => {
      const ownerId = requireOwner(ctx)
      const service = resolveWorkspaceFileTreeService(ctx)
      const terminal = ctx.resolve<TerminalService>("core.terminal")
      observeOwner(ctx, service, ownerId)
      return service.openScope({
        ownerId,
        rootPath: terminal.getCurrentWorkingDirectory(request.sessionId),
        surface: "terminal",
        sessionId: request.sessionId,
      })
    },
  },
  listWorkspaceTree: {
    operationId: "app.terminal.workspace_tree.list",
    kind: "invoke",
    request: workspaceFileTreeListInputSchema,
    response: workspaceFileTreeDirectoryResultSchema,
    handler: (ctx, request: z.infer<typeof workspaceFileTreeListInputSchema>) =>
      resolveWorkspaceFileTreeService(ctx).listDirectory({
        ownerId: requireOwner(ctx),
        ...request,
      }),
  },
  resolveWorkspaceTreePaths: {
    operationId: "app.terminal.workspace_tree.resolve_paths",
    kind: "invoke",
    request: workspaceFileTreeResolvePathsInputSchema,
    response: workspaceFileTreeResolvePathsResultSchema,
    handler: (ctx, request: z.infer<typeof workspaceFileTreeResolvePathsInputSchema>) =>
      resolveWorkspaceFileTreeService(ctx).resolvePaths({
        ownerId: requireOwner(ctx),
        ...request,
      }),
  },
  closeWorkspaceTree: {
    operationId: "app.terminal.workspace_tree.close",
    kind: "invoke",
    request: workspaceFileTreeScopeIdInputSchema,
    response: z.void(),
    handler: (ctx, request: z.infer<typeof workspaceFileTreeScopeIdInputSchema>) => {
      resolveWorkspaceFileTreeService(ctx).closeScope({
        ownerId: requireOwner(ctx),
        scopeId: request.scopeId,
      })
    },
  },
}

export const terminalWorkspaceTreeEvents: IpcModule["events"] = {
  workspaceTreeChanged: {
    operationId: "app.terminal.workspace_tree.changed",
    kind: "event",
    payload: workspaceFileTreeChangedEventSchema,
  },
}

function resolveWorkspaceFileTreeService(ctx: IpcHandlerContext): WorkspaceFileTreeService {
  const service = ctx.resolve<WorkspaceFileTreeService>(WORKSPACE_FILE_TREE_SERVICE_ID)
  if (!wiredServices.has(service)) {
    const windowManager = ctx.resolve<WindowManager>("core.window-manager")
    service.onChanged(({ ownerId, surface, ...payload }) => {
      if (surface !== "terminal") return
      windowManager.broadcast(
        ipcOperationIdToChannel(terminalWorkspaceTreeEvents.workspaceTreeChanged.operationId),
        payload,
        (window) => window.id === ownerId,
      )
    })
    wiredServices.add(service)
  }
  return service
}

function requireOwner(ctx: IpcHandlerContext): number {
  if (!ctx.sender || ctx.sender.isDestroyed()) throw new Error("Workspace file tree window is unavailable.")
  return ctx.sender.id
}

function observeOwner(ctx: IpcHandlerContext, service: WorkspaceFileTreeService, ownerId: number): void {
  const owners = observedOwners.get(service) ?? new Set<number>()
  if (owners.has(ownerId) || !ctx.sender) return
  owners.add(ownerId)
  observedOwners.set(service, owners)
  ctx.sender.onDestroyed(() => {
    owners.delete(ownerId)
    service.closeOwner(ownerId)
  })
}
