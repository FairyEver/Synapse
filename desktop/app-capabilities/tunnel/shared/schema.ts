import { z } from "zod"
import { TUNNEL_RUNTIME_STATUSES } from "@synapse/shared/tunnel-contracts"
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u)
const port = z.number().int().min(1).max(65535)
const revision = z.number().int().positive().max(2147483646)
export const tunnelMappingSchema = z.object({ id, clientInstanceId: id, deviceName: z.string().max(120), port, url: z.url().startsWith("https://"), enabled: z.boolean(), revision,
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), runtimeStatus: z.enum(TUNNEL_RUNTIME_STATUSES), lastErrorCode: z.string().max(100).nullable() }).strict()
export const tunnelPageSchema = z.object({ items: z.array(tunnelMappingSchema).max(100), nextOffset: z.number().int().nonnegative().nullable(), total: z.number().int().nonnegative(), currentClientInstanceId: id.optional() }).strict()
export const tunnelListSchema = z.object({ offset: z.number().int().nonnegative().max(2147483647).optional(), limit: z.number().int().min(1).max(100).optional(), clientInstanceId: id.optional() }).strict()
export const tunnelCreateSchema = z.object({ port, requestId: z.uuid().optional() }).strict()
export const tunnelLocatorSchema = z.object({ id }).strict()
export const tunnelUpdateSchema = z.object({ id, port, expectedRevision: revision }).strict()
export const tunnelEnableSchema = z.object({ id, enabled: z.boolean(), expectedRevision: revision }).strict()
export const tunnelDeleteSchema = z.object({ id, expectedRevision: revision }).strict()
export const tunnelDeletedSchema = z.object({ id, deleted: z.literal(true) }).strict()
export const tunnelFailureSchema = z.object({ status: z.number(), code: z.string(), message: z.string() }).strict()
export const tunnelResultSchema = <T extends z.ZodType>(data: T) => z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), data }), z.object({ ok: z.literal(false), failure: tunnelFailureSchema })])
