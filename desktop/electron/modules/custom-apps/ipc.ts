import {
  customAppBootstrapInputSchema,
  customAppCreateInputSchema,
  customAppDockOperationSchema,
  customAppIdSchema,
  customAppSnapshotSchema,
  customAppUpdateInputSchema,
  customAppsClientStateSchema,
  type CustomAppId,
  type CustomAppBootstrapInput,
  type CustomAppCreateInput,
  type CustomAppDockOperation,
  type CustomAppSnapshotDto,
  type CustomAppUpdateInput,
  type CustomAppsClientState,
  type CustomWebAppNavigationAction,
  type CustomWebAppViewState,
} from "@synapse/shared/custom-apps-contracts"
import { BrowserWindow, shell, webContents } from "electron"
import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import { runGuardedShellOperation } from "../shell/guarded-shell"
import { sanitizeUrl } from "../../../src/lib/url-sanitize"
import {
  CUSTOM_APPS_SERVICE_ID,
  type CustomAppsCatalogService,
} from "../../services/custom-apps/catalog-service"
import {
  CUSTOM_APP_FAVICON_SERVICE_ID,
  type CustomAppFaviconService,
} from "../../services/custom-apps/favicon-service"
import {
  CUSTOM_WEB_APP_RUNTIME_SERVICE_ID,
  type CustomWebAppRuntimeService,
  type WebViewBounds,
} from "../../services/custom-apps/runtime-service"
import {
  CUSTOM_WEB_APP_WINDOW_SERVICE_ID,
  type CustomWebAppWindowService,
} from "../../services/custom-apps/window-service"

const iconResultSchema = z.object({
  pngBase64: z.string().min(1),
  dataUrl: z.string().startsWith("data:image/png;base64,"),
}).strict().nullable()

const viewBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
}).strict()

const viewStateSchema = z.object({
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  isLoading: z.boolean(),
  currentUrl: z.string().min(1).nullable(),
  error: z.enum(["none", "load_failed", "certificate"]),
}).strict() as unknown as z.ZodType<CustomWebAppViewState>

const navigationActionSchema = z.enum(["back", "forward", "reload", "open-external"]) as unknown as z.ZodType<CustomWebAppNavigationAction>

const updateRequestSchema = z.object({
  id: customAppIdSchema,
  input: customAppUpdateInputSchema,
}).strict()

const deleteRequestSchema = z.object({
  id: customAppIdSchema,
  operationId: z.string().trim().min(1).max(200),
}).strict()

export const customAppIpcModule: IpcModule = {
  id: "customApps",
  methods: {
    getSnapshot: {
      kind: "invoke",
      operationId: "app.custom_apps.operation.get_state",
      request: z.void(),
      response: customAppsClientStateSchema as unknown as z.ZodType<CustomAppsClientState>,
      handler: (ctx) => ctx.resolve<CustomAppsCatalogService>(CUSTOM_APPS_SERVICE_ID).getState(),
    },
    retry: {
      kind: "invoke",
      operationId: "app.custom_apps.sync.retry",
      request: z.void(),
      response: customAppsClientStateSchema as unknown as z.ZodType<CustomAppsClientState>,
      handler: async (ctx) => {
        const service = ctx.resolve<CustomAppsCatalogService>(CUSTOM_APPS_SERVICE_ID)
        await service.refresh("manual")
        return service.getState()
      },
    },
    create: {
      kind: "invoke",
      operationId: "app.custom_apps.app.create",
      request: customAppCreateInputSchema as unknown as z.ZodType<CustomAppCreateInput>,
      response: customAppSnapshotSchema as unknown as z.ZodType<CustomAppSnapshotDto>,
      handler: (ctx, input: CustomAppCreateInput) => ctx.resolve<CustomAppsCatalogService>(CUSTOM_APPS_SERVICE_ID).create(input),
    },
    update: {
      kind: "invoke",
      operationId: "app.custom_apps.app.update",
      request: updateRequestSchema,
      response: customAppSnapshotSchema as unknown as z.ZodType<CustomAppSnapshotDto>,
      handler: (ctx, input: { readonly id: CustomAppId; readonly input: CustomAppUpdateInput }) => ctx.resolve<CustomAppsCatalogService>(CUSTOM_APPS_SERVICE_ID)
        .update(input.id as CustomAppId, input.input),
    },
    delete: {
      kind: "invoke",
      operationId: "app.custom_apps.app.delete",
      request: deleteRequestSchema,
      response: customAppSnapshotSchema as unknown as z.ZodType<CustomAppSnapshotDto>,
      handler: (ctx, input: { readonly id: CustomAppId; readonly operationId: string }) => ctx.resolve<CustomAppsCatalogService>(CUSTOM_APPS_SERVICE_ID)
        .delete(input.id as CustomAppId, input.operationId),
    },
    bootstrapDock: {
      kind: "invoke",
      operationId: "app.custom_apps.dock.bootstrap",
      request: customAppBootstrapInputSchema as unknown as z.ZodType<CustomAppBootstrapInput>,
      response: customAppSnapshotSchema as unknown as z.ZodType<CustomAppSnapshotDto>,
      handler: (ctx, input: CustomAppBootstrapInput) => ctx.resolve<CustomAppsCatalogService>(CUSTOM_APPS_SERVICE_ID)
        .bootstrapDock(input),
    },
    applyDockOperation: {
      kind: "invoke",
      operationId: "app.custom_apps.dock.apply",
      request: customAppDockOperationSchema as unknown as z.ZodType<CustomAppDockOperation>,
      response: customAppSnapshotSchema as unknown as z.ZodType<CustomAppSnapshotDto>,
      handler: (ctx, input: CustomAppDockOperation) => ctx.resolve<CustomAppsCatalogService>(CUSTOM_APPS_SERVICE_ID)
        .applyDockOperation(input),
    },
    fetchFavicon: {
      kind: "invoke",
      operationId: "app.custom_apps.icon.fetch_favicon",
      request: z.object({ url: z.string().min(1).max(2048) }).strict(),
      response: iconResultSchema,
      handler: (ctx, input: { readonly url: string }) => ctx.resolve<CustomAppFaviconService>(
        CUSTOM_APP_FAVICON_SERVICE_ID,
      ).fetchFavicon(input.url),
    },
    chooseIcon: {
      kind: "invoke",
      operationId: "app.custom_apps.icon.choose",
      request: z.void(),
      response: iconResultSchema,
      handler: (ctx) => ctx.resolve<CustomAppFaviconService>(CUSTOM_APP_FAVICON_SERVICE_ID).chooseIcon(),
    },
    attachView: {
      kind: "invoke",
      operationId: "app.custom_apps.view.attach",
      request: z.object({ appId: customAppIdSchema, bounds: viewBoundsSchema.optional() }).strict(),
      response: z.void(),
      handler: async (ctx, input: { readonly appId: CustomAppId; readonly bounds?: WebViewBounds }) => {
        const runtime = ctx.resolve<CustomWebAppRuntimeService>(CUSTOM_WEB_APP_RUNTIME_SERVICE_ID)
        const host = requireSenderHost(ctx)
        await runtime.attach(host, input.appId)
        if (input.bounds) runtime.setBounds(host, input.bounds)
      },
    },
    setViewBounds: {
      kind: "invoke",
      operationId: "app.custom_apps.view.set_bounds",
      request: z.object({ bounds: viewBoundsSchema }).strict(),
      response: z.void(),
      handler: (ctx, input: { readonly bounds: WebViewBounds }) => {
        ctx.resolve<CustomWebAppRuntimeService>(CUSTOM_WEB_APP_RUNTIME_SERVICE_ID)
          .setBounds(requireSenderHost(ctx), input.bounds)
      },
    },
    detachView: {
      kind: "invoke",
      operationId: "app.custom_apps.view.detach",
      request: z.void(),
      response: z.void(),
      handler: (ctx) => {
        ctx.resolve<CustomWebAppRuntimeService>(CUSTOM_WEB_APP_RUNTIME_SERVICE_ID)
          .detach(requireSenderHost(ctx))
      },
    },
    setViewOccluded: {
      kind: "invoke",
      operationId: "app.custom_apps.view.set_occluded",
      request: z.object({ occluded: z.boolean() }).strict(),
      response: z.void(),
      handler: (ctx, input: { readonly occluded: boolean }) => {
        ctx.resolve<CustomWebAppRuntimeService>(CUSTOM_WEB_APP_RUNTIME_SERVICE_ID)
          .setOccluded(requireSenderHost(ctx), input.occluded)
      },
    },
    getNavigationState: {
      kind: "invoke",
      operationId: "app.custom_apps.navigation.get_state",
      request: z.void(),
      response: viewStateSchema,
      handler: (ctx) => ctx.resolve<CustomWebAppRuntimeService>(CUSTOM_WEB_APP_RUNTIME_SERVICE_ID)
        .state(requireSenderHost(ctx)),
    },
    navigate: {
      kind: "invoke",
      operationId: "app.custom_apps.navigation.perform",
      request: z.object({ action: navigationActionSchema }).strict(),
      response: viewStateSchema,
      handler: async (ctx, input: { readonly action: CustomWebAppNavigationAction }) => {
        const runtime = ctx.resolve<CustomWebAppRuntimeService>(CUSTOM_WEB_APP_RUNTIME_SERVICE_ID)
        const host = requireSenderHost(ctx)
        if (input.action === "open-external") {
          const currentUrl = runtime.state(host).currentUrl
          if (!currentUrl) return runtime.state(host)
          const url = new URL(currentUrl)
          if (url.protocol !== "http:" && url.protocol !== "https:") return runtime.state(host)
          await runGuardedShellOperation({
            ctx,
            resource: sanitizeUrl(url.toString()),
            source: "custom-app.web.openExternal",
            run: () => shell.openExternal(url.toString()),
          })
          return runtime.state(host)
        }
        await runtime.navigate(host, input.action)
        return runtime.state(host)
      },
    },
    openWindow: {
      kind: "invoke",
      operationId: "app.custom_apps.window.open",
      request: z.object({ appId: customAppIdSchema }).strict(),
      response: z.void(),
      handler: (ctx, input: { readonly appId: CustomAppId }) => {
        return ctx.resolve<CustomWebAppWindowService>(CUSTOM_WEB_APP_WINDOW_SERVICE_ID).open(input.appId)
      },
    },
  },
  events: {
    changed: {
      kind: "event",
      operationId: "app.custom_apps.operation.changed",
      payload: customAppsClientStateSchema as unknown as z.ZodType<CustomAppsClientState>,
    },
    navigationStateChanged: {
      kind: "event",
      operationId: "app.custom_apps.navigation.state_changed",
      payload: z.object({
        appId: customAppIdSchema,
        state: viewStateSchema,
      }).strict(),
    },
  },
}

function requireSenderHost(ctx: Parameters<NonNullable<IpcModule["methods"][string]["handler"]>>[0]): BrowserWindow {
  if (!ctx.sender) throw new Error("Custom app IPC requires a sender window.")
  const contents = webContents.fromId(ctx.sender.id)
  const host = contents ? BrowserWindow.fromWebContents(contents) : null
  if (!host) throw new Error("Custom app IPC sender window is unavailable.")
  return host
}
