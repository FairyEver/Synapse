import { z } from "zod"
const port = z.number().int().min(1).max(65535)
const expectedRevision = z.number().int().positive().max(2147483646)
export const tunnelCreateSchema = z.object({ port, requestId: z.uuid() }).strict()
export const tunnelUpdateSchema = z.object({ port, expectedRevision }).strict()
export const tunnelEnableSchema = z.object({ enabled: z.boolean(), expectedRevision }).strict()
export const tunnelDeleteSchema = z.object({ expectedRevision }).strict()
export const tunnelListSchema = z.object({ offset: z.coerce.number().int().min(0).max(2147483647).default(0), limit: z.coerce.number().int().min(1).max(100).default(20), clientInstanceId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u).optional() }).strict()
