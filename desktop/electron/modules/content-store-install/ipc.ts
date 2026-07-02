import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import { contentInstallService } from "../../services/content-install-service"
import { contentStoreInstallService } from "../../services/content-store-install-service"

contentInstallService.addPreparedSourceProvider(contentStoreInstallService)

const sessionRequestSchema = z.object({
  sessionId: z.string().min(1),
}).strict()

const unauthenticatedSchema = z.object({
  status: z.literal("unauthenticated"),
}).strict()

const installSessionSchema = z.object({
  id: z.string().min(1),
  contentId: z.string().min(1),
  versionId: z.string().min(1),
  type: z.enum(["skill", "rule"]),
  title: z.string(),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  packageSize: z.string().regex(/^\d+$/).optional(),
  expiresAt: z.string().min(1),
}).strict()

const resolveResultSchema = z.discriminatedUnion("status", [
  unauthenticatedSchema,
  z.object({
    status: z.literal("ready"),
    session: installSessionSchema,
  }).strict(),
])

const preparedFileSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  kind: z.enum(["text", "binary"]),
}).strict()

const prepareResultSchema = z.discriminatedUnion("status", [
  unauthenticatedSchema,
  z.object({
    status: z.literal("prepared"),
    source: z.object({
      id: z.string().min(1),
      contentId: z.string().min(1),
      versionId: z.string().min(1),
      type: z.enum(["skill", "rule"]),
      title: z.string(),
      mainFile: z.enum(["content/SKILL.md", "content/RULE.md"]),
      mainContent: z.string(),
      files: z.array(preparedFileSchema),
    }).strict(),
  }).strict(),
])

const completionResultSchema = z.object({
  ok: z.literal(true),
}).strict()

export const contentStoreInstallIpcModule: IpcModule = {
  id: "content-store-install",
  methods: {
    resolve: {
      kind: "invoke",
      channel: "synapse:content-store-install:resolve",
      request: sessionRequestSchema,
      response: resolveResultSchema,
      handler: (_ctx, { sessionId }) => contentStoreInstallService.resolveInstallSession(sessionId),
    },
    prepare: {
      kind: "invoke",
      channel: "synapse:content-store-install:prepare",
      request: sessionRequestSchema,
      response: prepareResultSchema,
      handler: (_ctx, { sessionId }) => contentStoreInstallService.prepare(sessionId),
    },
    recordComplete: {
      kind: "invoke",
      channel: "synapse:content-store-install:record-complete",
      request: sessionRequestSchema,
      response: completionResultSchema,
      handler: (_ctx, { sessionId }) => contentStoreInstallService.recordComplete(sessionId),
    },
  },
  events: {},
}
