import { z } from "zod"
import { SKILL_UNINSTALL_MAX_TARGETS } from "../../../config"

const trimmedNonEmptyString = z.string().transform((value) => value.trim()).pipe(z.string().min(1))

export const skillUninstallQuerySchema = z.object({
  name: trimmedNonEmptyString,
  searchRootPath: trimmedNonEmptyString.optional(),
}).strict()

export const skillUninstallCandidateSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  frontmatterName: z.string().optional(),
  editorIds: z.array(z.string()),
  source: z.enum(["synapse", "external"]),
  synapseContentId: z.string().optional(),
}).strict()

export const skillUninstallScanResultSchema = z.object({
  candidates: z.array(skillUninstallCandidateSchema),
  complete: z.boolean(),
  warnings: z.array(z.string()),
}).strict()

export const skillUninstallNameScanResultSchema = z.object({
  names: z.array(z.string().min(1)),
  complete: z.boolean(),
  warnings: z.array(z.string()),
}).strict()

export const skillUninstallTargetSchema = z.object({
  query: skillUninstallQuerySchema,
  path: z.string().min(1),
}).strict()

export const skillUninstallBatchResultItemSchema = z.object({
  path: z.string().min(1),
  status: z.enum(["trashed", "failed", "skipped"]),
  error: z.string().optional(),
  warning: z.string().optional(),
}).strict()

export const skillUninstallBatchResultSchema = z.object({
  results: z.array(skillUninstallBatchResultItemSchema),
  cancelled: z.boolean().optional(),
}).strict()

export const skillUninstallRequestSchema = z.object({
  operationId: z.string().min(1),
  targets: z.array(skillUninstallTargetSchema).min(1).max(SKILL_UNINSTALL_MAX_TARGETS),
}).strict()

export const skillUninstallExecutionCancelRequestSchema = z.object({
  operationId: z.string().min(1),
}).strict()

export const skillUninstallScanRequestSchema = z.object({
  scanId: z.string().min(1),
  query: skillUninstallQuerySchema,
}).strict()

export const skillUninstallNameScanRequestSchema = z.object({
  scanId: z.string().min(1),
  searchRootPath: trimmedNonEmptyString.optional(),
}).strict()

export const skillUninstallCancelRequestSchema = z.object({
  scanId: z.string().min(1),
}).strict()

export type SkillUninstallQuery = z.infer<typeof skillUninstallQuerySchema>
export type SkillUninstallCandidate = z.infer<typeof skillUninstallCandidateSchema>
export type SkillUninstallScanResult = z.infer<typeof skillUninstallScanResultSchema>
export type SkillUninstallNameScanResult = z.infer<typeof skillUninstallNameScanResultSchema>
export type SkillUninstallTarget = z.infer<typeof skillUninstallTargetSchema>
export type SkillUninstallBatchResult = z.infer<typeof skillUninstallBatchResultSchema>
export type SkillUninstallRequest = z.infer<typeof skillUninstallRequestSchema>
export type SkillUninstallExecutionCancelRequest = z.infer<typeof skillUninstallExecutionCancelRequestSchema>
export type SkillUninstallScanRequest = z.infer<typeof skillUninstallScanRequestSchema>
export type SkillUninstallNameScanRequest = z.infer<typeof skillUninstallNameScanRequestSchema>
export type SkillUninstallCancelRequest = z.infer<typeof skillUninstallCancelRequestSchema>

export { SKILL_UNINSTALL_MAX_TARGETS }
