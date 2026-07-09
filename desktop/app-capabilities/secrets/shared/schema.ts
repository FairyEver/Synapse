import { z } from "zod"

export const SECRET_NAME_REGEX = /^[A-Za-z0-9_]+$/

export const secretNameSchema = z.string()
  .trim()
  .min(1, "密钥名称不能为空")
  .regex(SECRET_NAME_REGEX, "密钥名称只能包含字母、数字和下划线")

export const secretSafeViewSchema = z.object({
  id: z.string().min(1),
  name: secretNameSchema,
  description: z.string().optional(),
  hasValue: z.boolean(),
})

export const secretValueViewSchema = secretSafeViewSchema.extend({
  value: z.string(),
})

export const secretItemSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  name: secretNameSchema,
  value: z.string(),
  description: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export const secretListResultSchema = z.object({
  secrets: z.array(secretSafeViewSchema),
  total: z.number().int().nonnegative(),
})

export const secretUpsertResultSchema = z.object({
  secret: secretSafeViewSchema,
  created: z.boolean(),
})

export const secretGetInputSchema = z.object({
  name: secretNameSchema,
  includeValue: z.boolean().optional(),
})

export const secretCreateInputSchema = z.object({
  name: secretNameSchema,
  value: z.string(),
  description: z.string().optional(),
})

export const secretUpdateInputSchema = z.object({
  name: secretNameSchema,
  newName: secretNameSchema.optional(),
  value: z.string().optional(),
  description: z.string().optional(),
})

export const secretUpsertInputSchema = z.object({
  name: secretNameSchema,
  value: z.string().optional(),
  description: z.string().optional(),
})

export const secretDeleteInputSchema = z.object({
  name: secretNameSchema,
})

export const secretsChangedEventSchema = z.object({
  secrets: z.array(secretSafeViewSchema),
})

export type SecretSafeView = z.infer<typeof secretSafeViewSchema>
export type SecretValueView = z.infer<typeof secretValueViewSchema>
export type SecretListResult = z.infer<typeof secretListResultSchema>
export type SecretUpsertResult = z.infer<typeof secretUpsertResultSchema>
export type SecretGetInput = z.infer<typeof secretGetInputSchema>
export type SecretCreateInput = z.infer<typeof secretCreateInputSchema>
export type SecretUpdateInput = z.infer<typeof secretUpdateInputSchema>
export type SecretUpsertInput = z.infer<typeof secretUpsertInputSchema>
export type SecretDeleteInput = z.infer<typeof secretDeleteInputSchema>
export type SecretsChangedEvent = z.infer<typeof secretsChangedEventSchema>
