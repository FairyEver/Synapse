import { z } from "zod"

import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { WindowManager } from "../../runtime/window"
import {
  WORKSPACE_FILE_TREE_SERVICE_ID,
  type WorkspaceFileTreeService,
} from "../../services/workspace-file-tree-service"
import {
  workspaceFileTreeChangedEventSchema,
  workspaceFileTreeDirectoryResultSchema,
  workspaceFileTreeListInputSchema,
  workspaceFileTreeResolvePathsInputSchema,
  workspaceFileTreeResolvePathsResultSchema,
  workspaceFileTreeScopeIdInputSchema,
  workspaceFileTreeScopeSchema,
} from "../../services/workspace-file-tree-schema"
import { ipcOperationIdToChannel } from "../../../synapse-capabilities/shared/naming"
import { resolveProjectAgent } from "./ipc-shared"

const agentWorkspaceTreeOpenInputSchema = z.object({
  projectId: z.string().min(1),
})

const wiredServices = new WeakSet<WorkspaceFileTreeService>()
const observedOwners = new WeakMap<WorkspaceFileTreeService, Set<number>>()

export const agentWorkspaceTreeMethods: IpcModule["methods"] = {
  openWorkspaceTree: {
    operationId: "app.agent.workspace_tree.open",
    kind: "invoke",
    request: agentWorkspaceTreeOpenInputSchema,
    response: workspaceFileTreeScopeSchema,
    handler: async (ctx, request: z.infer<typeof agentWorkspaceTreeOpenInputSchema>) => {
      const ownerId = requireOwner(ctx)
      const service = resolveWorkspaceFileTreeService(ctx)
      observeOwner(ctx, service, ownerId)
      const { project } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return service.openScope({
        ownerId,
        rootPath: project.localPath,
        surface: "agent",
        projectId: request.projectId,
      })
    },
  },
  listWorkspaceTree: {
    operationId: "app.agent.workspace_tree.list",
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
    operationId: "app.agent.workspace_tree.resolve_paths",
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
    operationId: "app.agent.workspace_tree.close",
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

export const agentWorkspaceTreeEvents: IpcModule["events"] = {
  workspaceTreeChanged: {
    operationId: "app.agent.workspace_tree.changed",
    kind: "event",
    payload: workspaceFileTreeChangedEventSchema,
  },
}

function resolveWorkspaceFileTreeService(ctx: IpcHandlerContext): WorkspaceFileTreeService {
  const service = ctx.resolve<WorkspaceFileTreeService>(WORKSPACE_FILE_TREE_SERVICE_ID)
  if (!wiredServices.has(service)) {
    const windowManager = ctx.resolve<WindowManager>("core.window-manager")
    service.onChanged(({ ownerId, surface, ...payload }) => {
      if (surface !== "agent") return
      windowManager.broadcast(
        ipcOperationIdToChannel(agentWorkspaceTreeEvents.workspaceTreeChanged.operationId),
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
