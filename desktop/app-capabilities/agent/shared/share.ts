import { z } from "zod"
import type { SynapseAgentMessageTimelineItem } from "../../../src/types/agent"
import type { GeneratedUiSnapshot } from "../../../src/types/agent-generated-ui"
import { DEFAULT_AGENT_SHARE_SETTINGS } from "../../../src/types/agent-share"

export const AGENT_SHARE_SERVICE_ID = "core.agent-share"
export { shareSettingsSchema } from "../../../src/types/agent-share"
import { shareSettingsSchema } from "../../../src/types/agent-share"
const ref = z.string().min(1).max(200)
export const shareMessagesInputSchema = z.object({
  shareContextRef: ref, query: z.string().trim().min(1).max(256).optional(),
  offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50),
}).strict()
export const shareGenerateInputSchema = z.object({
  shareContextRef: ref,
  selection: z.enum(["latest_turn", "all", "assistant", "messages"]),
  messageRefs: z.array(ref).min(1).max(10_000).optional(),
  settings: shareSettingsSchema.default(DEFAULT_AGENT_SHARE_SETTINGS),
  idempotencyKey: z.string().uuid(),
}).strict().superRefine((v, ctx) => {
  if ((v.selection === "messages") !== Boolean(v.messageRefs?.length)) ctx.addIssue({ code: "custom", message: "messageRefs is required only for selection=messages" })
})
export const shareOutputInputSchema = z.object({
  shareImageRef: ref, action: z.enum(["copy", "save"]), outputPath: z.string().min(1).max(4096).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.action !== "save" && v.outputPath) ctx.addIssue({ code: "custom", message: "outputPath is only accepted for save" })
})
export type ShareSelection = z.infer<typeof shareGenerateInputSchema>["selection"]
export type ShareMessageSnapshot = SynapseAgentMessageTimelineItem & {
  role: "user" | "assistant"; messageRef: string; turnRef: string; ordinal: number
}
export const shareImageSummarySchema = z.object({
  shareImageRef: z.string().uuid(), projectId: z.string(), conversationId: z.string(), turnId: z.string(),
  sourceHistoryIndex: z.number().int().nonnegative(), sourceTimestamp: z.string(),
  fileName: z.string(), width: z.number().int().positive(), height: z.number().int().positive(), byteSize: z.number().int().positive(),
  sha256: z.string(), createdAt: z.string(), messageRefs: z.array(z.string()).max(10_000), contentSummary: z.string(),
}).strict()
export type ShareImageSummary = z.infer<typeof shareImageSummarySchema>
export const shareRenderErrors = {
  render_failed: "图片渲染失败，请检查内容和资源后重试。",
  limit_exceeded: "图片过长或过大，请缩小分享范围。",
  resource_failed: "图片或图表资源未完整加载，请检查原消息后重试。",
  layout_failed: "内容超出图片宽度或包含滚动区域，请使用宽版或缩小范围。",
} as const

export interface ShareRenderRequest {
  requestId: string; nonce: string; projectId: string; conversationId: string
  messages: ShareMessageSnapshot[]; settings: z.infer<typeof shareSettingsSchema>
  generatedUi: Record<string, GeneratedUiSnapshot>
}
export interface ShareRenderResponse { requestId: string; nonce: string; projectId: string; conversationId: string; pngBase64?: string; error?: string }
export interface ShareImageSource { bytes: Buffer; fileName: string; mimeType: "image/png" }

export type ShareDomainEvent = { domain: "agent"; type: "shareRenderCancelled"; payload: { requestId: string } } | { domain: "agent"; type: "shareRender"; payload: ShareRenderRequest } | { domain: "agent"; type: "shareImagesChanged"; payload: { projectId: string; conversationId: string } }
