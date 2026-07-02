import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import { editorInstallService } from "../../services/editor-install-service"
import { skillRepositoryInstallService } from "../../services/skill-repository-install-service"

editorInstallService.addPreparedSourceProvider(skillRepositoryInstallService)

const sessionRequestSchema = z.object({
  sessionId: z.string().min(1),
}).strict()

const unauthenticatedSchema = z.object({
  status: z.literal("unauthenticated"),
}).strict()

const installSessionSchema = z.object({
  id: z.string().min(1),
  repository: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    title: z.string(),
    owner: z.object({
      id: z.string().min(1),
      handle: z.string().nullable(),
      displayName: z.string().nullable(),
    }).strict(),
  }).strict(),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  packageSize: z.number().int().nonnegative(),
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
      repositoryId: z.string().min(1),
      repositoryName: z.string().min(1),
      ownerHandle: z.string().min(1),
      title: z.string(),
      mainFile: z.literal("content/SKILL.md"),
      mainContent: z.string(),
      files: z.array(preparedFileSchema),
    }).strict(),
  }).strict(),
])

const completionResultSchema = z.object({
  ok: z.literal(true),
}).strict()

export const skillRepositoryInstallIpcModule: IpcModule = {
  id: "skill-repository-install",
  methods: {
    resolve: {
      kind: "invoke",
      channel: "synapse:skill-repository-install:resolve",
      request: sessionRequestSchema,
      response: resolveResultSchema,
      handler: (_ctx, { sessionId }) => skillRepositoryInstallService.resolveInstallSession(sessionId),
    },
    prepare: {
      kind: "invoke",
      channel: "synapse:skill-repository-install:prepare",
      request: sessionRequestSchema,
      response: prepareResultSchema,
      handler: (_ctx, { sessionId }) => skillRepositoryInstallService.prepare(sessionId),
    },
    recordComplete: {
      kind: "invoke",
      channel: "synapse:skill-repository-install:record-complete",
      request: sessionRequestSchema,
      response: completionResultSchema,
      handler: (_ctx, { sessionId }) => skillRepositoryInstallService.recordComplete(sessionId),
    },
  },
  events: {},
}
