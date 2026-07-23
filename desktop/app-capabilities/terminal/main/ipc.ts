import { BrowserWindow, dialog } from "electron"
import { z } from "zod"

import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../electron/runtime/window"
import { ipcOperationIdToChannel } from "../../../synapse-capabilities/shared/naming"
import type { TerminalService } from "./service"
import {
  terminalAttachSessionInputSchema,
  terminalAttachSessionResultSchema,
  terminalCreateGroupCommandInputSchema,
  terminalCreateGroupInputSchema,
  terminalCreateSessionInputSchema,
  terminalDeleteGroupCommandInputSchema,
  terminalDeleteGroupInputSchema,
  terminalDeleteSessionInputSchema,
  terminalGroupCommandSchema,
  terminalGroupSchema,
  terminalLaunchGroupCommandInputSchema,
  terminalOutputChunkSchema,
  terminalReadSessionInputSchema,
  terminalReadSessionResultSchema,
  terminalRenameGroupInputSchema,
  terminalRenameSessionInputSchema,
  terminalResizeSessionInputSchema,
  terminalResizedEventSchema,
  terminalRunStartupCommandInputSchema,
  terminalSessionIdInputSchema,
  terminalSessionSchema,
  terminalStopSessionInputSchema,
  terminalUpdateGroupCommandInputSchema,
  terminalUpdateGroupSettingsInputSchema,
  terminalWriteSessionInputSchema,
} from "../shared/schema"

const terminalDataEventPayloadSchema = z.object({
  sessionId: z.string().min(1),
  chunk: terminalOutputChunkSchema,
})

const terminalSessionDeletedEventPayloadSchema = z.object({
  sessionId: z.string().min(1),
})

const terminalDomainChangedEventPayloadSchema = z.object({
  domainRevision: z.number().int().positive(),
  eventType: z.string().min(1),
  objectId: z.string().min(1),
  objectRevision: z.number().int().nonnegative(),
  occurredAt: z.string().min(1),
  source: z.string().min(1),
  operationId: z.string().min(1).optional(),
})

const terminalEventWiredServices = new WeakSet<TerminalService>()

function resolveTerminalService(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): TerminalService {
  const service = ctx.resolve<TerminalService>("core.terminal")
  wireTerminalEvents(ctx, service)
  return service
}

function wireTerminalEvents(
  ctx: Parameters<IpcModule["methods"][string]["handler"]>[0],
  service: TerminalService,
): void {
  if (terminalEventWiredServices.has(service)) return

  const windowManager = ctx.resolve<WindowManager>("core.window-manager")
  service.events.on("data", (payload) => {
    windowManager.broadcast(ipcOperationIdToChannel(terminalIpcModule.events.data.operationId), payload)
  })
  service.events.on("sessionChanged", (payload) => {
    windowManager.broadcast(ipcOperationIdToChannel(terminalIpcModule.events.sessionChanged.operationId), payload)
  })
  service.events.on("sessionDeleted", (payload) => {
    windowManager.broadcast(ipcOperationIdToChannel(terminalIpcModule.events.sessionDeleted.operationId), payload)
  })
  service.events.on("resized", (payload) => {
    windowManager.broadcast(ipcOperationIdToChannel(terminalIpcModule.events.resized.operationId), payload)
  })
  service.events.on("domainChanged", (payload) => {
    windowManager.broadcast(ipcOperationIdToChannel(terminalIpcModule.events.domainChanged.operationId), payload)
  })
  terminalEventWiredServices.add(service)
}

export const terminalIpcModule: IpcModule = {
  id: "terminal",
  methods: {
    listGroups: {
      operationId: "app.terminal.group.list",
      kind: "invoke",
      request: z.void(),
      response: z.array(terminalGroupSchema),
      handler: (ctx) => resolveTerminalService(ctx).listGroups(),
    },
    createGroup: {
      operationId: "app.terminal.group.create",
      kind: "invoke",
      request: terminalCreateGroupInputSchema,
      response: terminalGroupSchema,
      handler: (ctx, request: z.infer<typeof terminalCreateGroupInputSchema>) =>
        resolveTerminalService(ctx).createGroup(request),
    },
    renameGroup: {
      operationId: "app.terminal.group.rename",
      kind: "invoke",
      request: terminalRenameGroupInputSchema,
      response: terminalGroupSchema,
      handler: (ctx, request: z.infer<typeof terminalRenameGroupInputSchema>) =>
        resolveTerminalService(ctx).renameGroup(request),
    },
    updateGroupSettings: {
      operationId: "app.terminal.group.update_settings",
      kind: "invoke",
      request: terminalUpdateGroupSettingsInputSchema,
      response: terminalGroupSchema,
      handler: (ctx, request: z.infer<typeof terminalUpdateGroupSettingsInputSchema>) =>
        resolveTerminalService(ctx).updateGroupSettings(request),
    },
    createGroupCommand: {
      operationId: "app.terminal.group_command.create",
      kind: "invoke",
      request: terminalCreateGroupCommandInputSchema,
      response: terminalGroupCommandSchema,
      handler: (ctx, request: z.infer<typeof terminalCreateGroupCommandInputSchema>) =>
        resolveTerminalService(ctx).createGroupCommand(request),
    },
    updateGroupCommand: {
      operationId: "app.terminal.group_command.update",
      kind: "invoke",
      request: terminalUpdateGroupCommandInputSchema,
      response: terminalGroupCommandSchema,
      handler: (ctx, request: z.infer<typeof terminalUpdateGroupCommandInputSchema>) =>
        resolveTerminalService(ctx).updateGroupCommand(request),
    },
    deleteGroupCommand: {
      operationId: "app.terminal.group_command.delete",
      kind: "invoke",
      request: terminalDeleteGroupCommandInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof terminalDeleteGroupCommandInputSchema>) =>
        resolveTerminalService(ctx).deleteGroupCommand(request),
    },
    launchGroupCommand: {
      operationId: "app.terminal.group_command.launch",
      kind: "invoke",
      request: terminalLaunchGroupCommandInputSchema,
      response: terminalSessionSchema,
      handler: (ctx, request: z.infer<typeof terminalLaunchGroupCommandInputSchema>) =>
        resolveTerminalService(ctx).launchGroupCommand(request),
    },
    chooseDefaultCwd: {
      operationId: "app.terminal.group.choose_default_cwd",
      kind: "invoke",
      request: z.void().optional(),
      response: z.string().nullable(),
      handler: async () => {
        const parentWindow = focusedWindow()
        const options = {
          title: "选择默认目录",
          properties: ["openDirectory"] as Electron.OpenDialogOptions["properties"],
        }
        const result = parentWindow
          ? await dialog.showOpenDialog(parentWindow, options)
          : await dialog.showOpenDialog(options)
        return result.canceled ? null : result.filePaths[0] ?? null
      },
    },
    deleteGroup: {
      operationId: "app.terminal.group.delete",
      kind: "invoke",
      request: terminalDeleteGroupInputSchema,
      response: z.void(),
      handler: async (ctx, request: z.infer<typeof terminalDeleteGroupInputSchema>) => {
        const service = resolveTerminalService(ctx)
        const members = service.listSessions().filter((session) => session.groupId === request.groupId)
        if (members.length === 0) return service.deleteGroup(request)
        const plan = service.previewGroupDelete(request.groupId)
        await service.commitGroupDelete(plan.deletePlanId)
      },
    },
    listSessions: {
      operationId: "app.terminal.session.list",
      kind: "invoke",
      request: z.void(),
      response: z.array(terminalSessionSchema),
      handler: (ctx) => resolveTerminalService(ctx).listSessions(),
    },
    createSession: {
      operationId: "app.terminal.session.create",
      kind: "invoke",
      request: terminalCreateSessionInputSchema,
      response: terminalSessionSchema,
      handler: (ctx, request: z.infer<typeof terminalCreateSessionInputSchema>) =>
        resolveTerminalService(ctx).createSession(request),
    },
    getSession: {
      operationId: "app.terminal.session.get",
      kind: "invoke",
      request: terminalSessionIdInputSchema,
      response: terminalSessionSchema,
      handler: (ctx, request: z.infer<typeof terminalSessionIdInputSchema>) =>
        resolveTerminalService(ctx).getSession(request),
    },
    attachSession: {
      operationId: "app.terminal.session.attach",
      kind: "invoke",
      request: terminalAttachSessionInputSchema,
      response: terminalAttachSessionResultSchema,
      handler: (ctx, request: z.infer<typeof terminalAttachSessionInputSchema>) =>
        resolveTerminalService(ctx).attachSession(request),
    },
    readSession: {
      operationId: "app.terminal.session.read",
      kind: "invoke",
      request: terminalReadSessionInputSchema,
      response: terminalReadSessionResultSchema,
      handler: (ctx, request: z.infer<typeof terminalReadSessionInputSchema>) =>
        resolveTerminalService(ctx).readSession(request),
    },
    renameSession: {
      operationId: "app.terminal.session.rename",
      kind: "invoke",
      request: terminalRenameSessionInputSchema,
      response: terminalSessionSchema,
      handler: (ctx, request: z.infer<typeof terminalRenameSessionInputSchema>) =>
        resolveTerminalService(ctx).renameSession(request),
    },
    writeSession: {
      operationId: "app.terminal.session.write",
      kind: "invoke",
      request: terminalWriteSessionInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof terminalWriteSessionInputSchema>) =>
        resolveTerminalService(ctx).writeSession(request),
    },
    resizeSession: {
      operationId: "app.terminal.session.resize",
      kind: "invoke",
      request: terminalResizeSessionInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof terminalResizeSessionInputSchema>) =>
        resolveTerminalService(ctx).resizeSession(request),
    },
    deleteSession: {
      operationId: "app.terminal.session.delete",
      kind: "invoke",
      request: terminalDeleteSessionInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof terminalDeleteSessionInputSchema>) =>
        resolveTerminalService(ctx).deleteSession(request),
    },
    stopSession: {
      operationId: "app.terminal.session.stop",
      kind: "invoke",
      request: terminalStopSessionInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof terminalStopSessionInputSchema>) =>
        resolveTerminalService(ctx).stopSession(request),
    },
    runStartupCommand: {
      operationId: "app.terminal.session.run_startup_command",
      kind: "invoke",
      request: terminalRunStartupCommandInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof terminalRunStartupCommandInputSchema>) =>
        resolveTerminalService(ctx).runStartupCommand(request),
    },
  },
  events: {
    data: {
      operationId: "app.terminal.operation.data",
      kind: "event",
      payload: terminalDataEventPayloadSchema,
    },
    sessionChanged: {
      operationId: "app.terminal.operation.session_changed",
      kind: "event",
      payload: terminalSessionSchema,
    },
    sessionDeleted: {
      operationId: "app.terminal.operation.session_deleted",
      kind: "event",
      payload: terminalSessionDeletedEventPayloadSchema,
    },
    resized: {
      operationId: "app.terminal.operation.resized",
      kind: "event",
      payload: terminalResizedEventSchema,
    },
    domainChanged: {
      operationId: "app.terminal.operation.domain_changed",
      kind: "event",
      payload: terminalDomainChangedEventPayloadSchema,
    },
  },
}

function focusedWindow(): Electron.BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow()
    ?? BrowserWindow.getAllWindows().find((window) => window.isVisible() && !window.isDestroyed())
    ?? undefined
}
