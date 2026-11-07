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
} from "@synapse/shared/custom-apps-contracts"
import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import {
  CUSTOM_APPS_SERVICE_ID,
  type CustomAppsCatalogService,
} from "../../services/custom-apps/catalog-service"
import {
  CUSTOM_APP_FAVICON_SERVICE_ID,
  type CustomAppFaviconService,
} from "../../services/custom-apps/favicon-service"

const iconResultSchema = z.object({
  pngBase64: z.string().min(1),
  dataUrl: z.string().startsWith("data:image/png;base64,"),
}).strict().nullable()

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
  },
  events: {
    changed: {
      kind: "event",
      operationId: "app.custom_apps.operation.changed",
      payload: customAppsClientStateSchema as unknown as z.ZodType<CustomAppsClientState>,
    },
  },
}
