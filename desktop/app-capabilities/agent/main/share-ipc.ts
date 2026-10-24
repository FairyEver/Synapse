import { z } from "zod"
import type { IpcHandlerContext, IpcModule } from "../../../electron/runtime/ipc/types"
import { AGENT_SHARE_MAX_PNG_BYTES } from "../../../src/types/agent-share"
import { AGENT_SHARE_SERVICE_ID, shareImageSummarySchema, shareOutputInputSchema, type ShareRenderResponse } from "../shared/share"
import type { AgentShareService } from "./share-service"

export const shareRenderIdentitySchema = z.object({ requestId: z.string().uuid(), nonce: z.string().uuid(), projectId: z.string().min(1), conversationId: z.string().min(1) }).strict()
const imageIdentity = z.object({ projectId: z.string().min(1), conversationId: z.string().min(1), shareImageRef: z.string().uuid() }).strict()
const target = imageIdentity.omit({ shareImageRef: true }).extend({ offset: z.number().int().nonnegative().default(0) })
const maxBase64 = Math.ceil(AGENT_SHARE_MAX_PNG_BYTES / 3) * 4
const service = (ctx: IpcHandlerContext) => ctx.resolve<AgentShareService>(AGENT_SHARE_SERVICE_ID)
function caller(ctx: IpcHandlerContext) {
  if (!ctx.sender) throw new Error("窗口不可用。")
  return { actor: { kind: "user" as const, id: `renderer:${ctx.sender.id}` }, clientId: `renderer:${ctx.sender.id}` }
}
async function checkImage(ctx: IpcHandlerContext, input: z.infer<typeof imageIdentity>) {
  caller(ctx)
  await service(ctx).assertImageTarget(input.shareImageRef, input.projectId, input.conversationId)
}
export const shareDeliveryMethods: IpcModule["methods"] = {
  completeShareRender: {
    kind: "invoke", operationId: "app.agent.share_render.complete",
    request: shareRenderIdentitySchema.extend({ pngBase64: z.string().max(maxBase64).optional(), error: z.string().max(512).optional() }).strict().refine(input => Boolean(input.pngBase64) !== Boolean(input.error), "Provide either pixels or a failure."),
    response: z.object({ success: z.boolean() }),
    handler: async (ctx, input: ShareRenderResponse) => { caller(ctx); await service(ctx).complete(ctx.sender!.id, input); return { success: true } },
  },
  listShareImages: {
    kind: "invoke", operationId: "app.agent.share_images.list", request: target, response: z.array(shareImageSummarySchema),
    handler: async (ctx, input: z.infer<typeof target>) => { caller(ctx); return service(ctx).list(input.projectId, input.conversationId, input.offset) },
  },
  readShareImage: {
    kind: "invoke", operationId: "app.agent.share_images.read", request: imageIdentity,
    response: z.object({ pngBase64: z.string().max(maxBase64) }), maxResponseBytes: maxBase64 + 1024,
    handler: async (ctx, input: z.infer<typeof imageIdentity>) => { await checkImage(ctx, input); const source = await service(ctx).readImage(input.shareImageRef, caller(ctx)); return { pngBase64: source.bytes.toString("base64") } },
  },
  outputShareImage: {
    kind: "invoke", operationId: "app.agent.share_images.output",
    request: imageIdentity.extend({ action: z.enum(["copy", "save"]) }).strict(), response: z.object({ success: z.boolean(), filePath: z.string().optional() }),
    handler: async (ctx, input: z.infer<typeof imageIdentity> & { action: "copy" | "save" }) => { await checkImage(ctx, input); return service(ctx).output(shareOutputInputSchema.parse({ shareImageRef: input.shareImageRef, action: input.action }), caller(ctx), ctx.sender!.id) },
  },
}
