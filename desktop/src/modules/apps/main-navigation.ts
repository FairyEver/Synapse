import { z } from "zod"
import { mailOpenRequestSchema } from "../../../app-capabilities/mail/shared/private-schema"
import { notificationOpenSchema } from "../../types/notification-center"

const id = z.string().min(1).max(200)
const target = <K extends string>(key: K) => z.object({ requestId: id, [key]: id } as { requestId: typeof id } & Record<K, typeof id>).strict()
const mailTarget = mailOpenRequestSchema.refine((request) => !request.compose)
const contentTarget = z.object({
  kind: z.enum(["create", "detail", "edit-overwrite"]),
  requestId: id,
  contentType: z.enum(["rule", "skill"]),
  contentId: id.optional(),
  initialValue: z.object({ name: z.string() }).passthrough().optional(),
  prefill: z.object({ content: z.string() }).passthrough().optional(),
  sourceLabel: z.string().optional(),
}).passthrough().refine((request) => {
  if (request.kind === "detail") return Boolean(request.contentId)
  if (request.sourceLabel === undefined) return false
  return request.kind === "create" ? Boolean(request.initialValue) : Boolean(request.contentId && request.prefill)
})

export const mainNavigationTargetSchema = z.discriminatedUnion("appId", [
  z.object({ appId: z.literal("terminal"), target: target("sessionId") }).strict(),
  z.object({ appId: z.literal("mail"), target: mailTarget }).strict(),
  z.object({ appId: z.literal("mail-internal"), target: target("messageId") }).strict(),
  z.object({ appId: z.literal("todos"), target: target("id") }).strict(),
  z.object({ appId: z.literal("meeting"), target: id }).strict(),
  z.object({ appId: z.literal("git"), target: target("repositoryId") }).strict(),
  z.object({ appId: z.literal("resource-repository"), target: contentTarget }).strict(),
  z.object({ appId: z.literal("connectors") }).strict(),
])

export const mainNavigationInputSchema = z.union([
  mainNavigationTargetSchema,
  z.object({
    appId: z.literal("message-center"),
    target: notificationOpenSchema.nullable(),
    otherDevice: z.boolean().optional(),
  }).strict(),
])

export const mainNavigationRequestSchema = z.object({
  id: z.number().int().positive(),
  destination: mainNavigationInputSchema,
  ownerId: id.nullable(),
}).strict()

export type MainNavigationTarget = z.infer<typeof mainNavigationTargetSchema>
export type MainNavigationInput = z.infer<typeof mainNavigationInputSchema>
export type MainNavigationRequest = z.infer<typeof mainNavigationRequestSchema>
