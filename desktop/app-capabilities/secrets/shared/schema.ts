import { z } from "zod"
import { SKILL_ENV_MAX_VARIABLES } from "../../../config"

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
  value: z.string().optional(),
  description: z.string().optional(),
}).strict()

export const secretUpsertInputSchema = z.object({
  name: secretNameSchema,
  value: z.string().optional(),
  description: z.string().optional(),
})

export const secretMcpUpsertInputSchema = secretUpsertInputSchema.extend({
  value: z.string(),
})

export const secretDeleteInputSchema = z.object({
  name: secretNameSchema,
})

export const secretsChangedEventSchema = z.object({
  secrets: z.array(secretSafeViewSchema),
})

export const skillEnvBindingStatusSchema = z.enum([
  "needs_update",
  "up_to_date",
  "invalid",
  "unwritable",
  "unsafe_link",
])

const skillEnvBindingEditorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
}).strict()

export const skillEnvBindingItemSchema = z.object({
  id: z.string().min(1),
  skillName: z.string().min(1),
  editors: z.array(skillEnvBindingEditorSchema),
  scope: z.enum(["global", "project"]),
  projectId: z.string().min(1).optional(),
  projectName: z.string().min(1).optional(),
  envPath: z.string().min(1),
  status: skillEnvBindingStatusSchema,
  message: z.string().max(200).optional(),
}).strict()

export const skillEnvBindingWarningSchema = skillEnvBindingItemSchema
  .omit({ id: true, status: true })
  .extend({
    status: z.enum(["invalid", "unwritable", "unsafe_link"]),
  })
  .strict()

export const secretSkillEnvScanInputSchema = z.object({
  name: secretNameSchema,
}).strict()

export const secretSkillEnvScanResultSchema = z.object({
  scanSessionId: z.string().min(1),
  items: z.array(skillEnvBindingItemSchema),
  warnings: z.array(skillEnvBindingWarningSchema).optional(),
  failed: z.boolean().optional(),
  truncated: z.boolean().optional(),
}).strict()

export const secretSkillEnvBatchScanInputSchema = z.object({
  names: z.array(secretNameSchema)
    .min(1)
    .max(SKILL_ENV_MAX_VARIABLES, `一次最多扫描 ${SKILL_ENV_MAX_VARIABLES} 个 Skill 环境变量。`)
    .refine(
    (names) => new Set(names.map((name) => name.toLowerCase())).size === names.length,
    "密钥名称不能重复。",
  ),
}).strict()

export const secretSkillEnvBatchScanResultSchema = z.object({
  groups: z.array(z.object({
    name: secretNameSchema,
    scanResult: secretSkillEnvScanResultSchema,
  }).strict()),
}).strict()

export const secretSkillEnvQueueInputSchema = z.object({
  name: secretNameSchema,
  scanSessionId: z.string().min(1),
  itemIds: z.array(z.string().min(1)),
}).strict()

export const skillEnvBindingQueueItemSchema = skillEnvBindingItemSchema.omit({ status: true }).extend({
  status: z.enum(["updated", "failed", "conflict"]),
}).strict()

export const secretSkillEnvQueueResultSchema = z.object({
  items: z.array(skillEnvBindingQueueItemSchema),
}).strict()

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
export type SkillEnvBindingItem = z.infer<typeof skillEnvBindingItemSchema>
export type SkillEnvBindingWarning = z.infer<typeof skillEnvBindingWarningSchema>
export type SecretSkillEnvScanInput = z.infer<typeof secretSkillEnvScanInputSchema>
export type SecretSkillEnvScanResult = z.infer<typeof secretSkillEnvScanResultSchema>
export type SecretSkillEnvBatchScanInput = z.infer<typeof secretSkillEnvBatchScanInputSchema>
export type SecretSkillEnvBatchScanResult = z.infer<typeof secretSkillEnvBatchScanResultSchema>
export type SecretSkillEnvQueueInput = z.infer<typeof secretSkillEnvQueueInputSchema>
export type SkillEnvBindingQueueItem = z.infer<typeof skillEnvBindingQueueItemSchema>
export type SecretSkillEnvQueueResult = z.infer<typeof secretSkillEnvQueueResultSchema>
