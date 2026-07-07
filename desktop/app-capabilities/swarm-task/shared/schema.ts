import { z } from "zod"

export const swarmRunModeSchema = z.enum(["batch", "continuous"])
export const swarmOutputModeSchema = z.enum(["managed-directory", "target-file", "both"])
export const swarmTargetFilePolicySchema = z.enum(["append-only", "section-update", "free-edit"])
export const swarmRunStatusSchema = z.enum(["running", "draining", "success", "partial", "failed", "cancelled"])
export const swarmWorkerRunStatusSchema = z.enum(["queued", "running", "success", "failed", "cancelled", "timeout"])
export const swarmWorkerPhaseSchema = z.enum([
  "queued",
  "thinking",
  "reading",
  "writing",
  "command",
  "permission",
  "completed",
  "failed",
])

export const swarmInjectOptionsSchema = z.object({
  workerIdentity: z.boolean().default(true),
  roundContext: z.boolean().default(true),
  runContext: z.boolean().default(true),
  outputProtocol: z.boolean().default(true),
  parallelContext: z.boolean().default(true),
  gitContext: z.boolean().default(false),
  customAppendix: z.string().max(16 * 1024).optional().default(""),
}).strict()

export const swarmOutputConfigSchema = z.object({
  mode: swarmOutputModeSchema.default("managed-directory"),
  managedDirectory: z.string().min(1).optional(),
  targetFile: z.string().min(1).optional(),
  targetFilePolicy: swarmTargetFilePolicySchema.default("append-only"),
}).strict()

export const swarmSummaryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  injectRecent: z.boolean().default(false),
  recentLimit: z.number().int().min(1).max(20).default(3),
}).strict()

export const swarmHandoffConfigSchema = z.object({
  enabled: z.boolean().default(false),
}).strict()

export const swarmAgentConfigSchema = z.object({
  providerId: z.string().min(1).optional(),
  modelTier: z.string().min(1).optional(),
  permissionMode: z.string().min(1).optional(),
  mainThreadPersonaId: z.string().min(1).nullable().optional(),
}).strict()

export const swarmTaskConfigSchema = z.object({
  projectId: z.string().min(1),
  workspacePath: z.string().min(1),
  prompt: z.string().min(1).max(256 * 1024),
  presetId: z.string().min(1).default("general"),
  injectOptions: swarmInjectOptionsSchema.default({}),
  runMode: swarmRunModeSchema.default("batch"),
  concurrency: z.number().int().min(1).max(20).default(3),
  maxRounds: z.number().int().min(1).max(500).default(3),
  output: swarmOutputConfigSchema.default({}),
  summary: swarmSummaryConfigSchema.default({}),
  handoff: swarmHandoffConfigSchema.default({}),
  agent: swarmAgentConfigSchema.default({}),
}).strict()

export const swarmRunTotalsSchema = z.object({
  started: z.number().int().min(0),
  success: z.number().int().min(0),
  failed: z.number().int().min(0),
  cancelled: z.number().int().min(0),
  timeout: z.number().int().min(0),
}).strict()

export const swarmTaskSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(120),
  description: z.string().max(4096).optional(),
  currentConfig: swarmTaskConfigSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastRunId: z.string().min(1).optional(),
  lastStatus: swarmRunStatusSchema.optional(),
}).strict()

export const swarmRunSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  taskId: z.string().min(1),
  status: swarmRunStatusSchema,
  configSnapshot: swarmTaskConfigSchema,
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1).optional(),
  totals: swarmRunTotalsSchema,
  outputDirectory: z.string().min(1).optional(),
  stopRequested: z.boolean(),
}).strict()

export const swarmWorkerRunSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  taskId: z.string().min(1),
  runId: z.string().min(1),
  workerIndex: z.number().int().min(1),
  roundIndex: z.number().int().min(1),
  status: swarmWorkerRunStatusSchema,
  conversationId: z.string().min(1).optional(),
  sessionKey: z.string().min(1),
  startedAt: z.string().min(1).optional(),
  finishedAt: z.string().min(1).optional(),
  lastPhase: swarmWorkerPhaseSchema.optional(),
  lastMessage: z.string().max(2000).optional(),
  summary: z.string().max(64 * 1024).optional(),
  summaryFallback: z.boolean().optional(),
  handoff: z.string().max(64 * 1024).optional(),
  error: z.string().max(4000).optional(),
}).strict()

export const swarmTaskCreateInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(4096).optional(),
  config: swarmTaskConfigSchema,
}).strict()

export const swarmTaskUpdateInputSchema = z.object({
  taskId: z.string().min(1),
  patch: z.object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(4096).optional(),
    currentConfig: swarmTaskConfigSchema.optional(),
  }).strict(),
}).strict()

export const swarmTaskIdInputSchema = z.object({
  taskId: z.string().min(1),
}).strict()

export const swarmRunIdInputSchema = z.object({
  runId: z.string().min(1),
}).strict()

export const swarmRunStartInputSchema = z.object({
  taskId: z.string().min(1),
  configOverride: swarmTaskConfigSchema.partial().optional(),
}).strict()

export const swarmRunListInputSchema = z.object({
  taskId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict()

export const swarmTaskListResultSchema = z.array(swarmTaskSchema)
export const swarmRunListResultSchema = z.array(swarmRunSchema)
export const swarmWorkerRunListResultSchema = z.array(swarmWorkerRunSchema)

export type SwarmRunMode = z.infer<typeof swarmRunModeSchema>
export type SwarmRunStatus = z.infer<typeof swarmRunStatusSchema>
export type SwarmWorkerRunStatus = z.infer<typeof swarmWorkerRunStatusSchema>
export type SwarmWorkerPhase = z.infer<typeof swarmWorkerPhaseSchema>
export type SwarmTaskConfig = z.infer<typeof swarmTaskConfigSchema>
export type SwarmTask = z.infer<typeof swarmTaskSchema>
export type SwarmRun = z.infer<typeof swarmRunSchema>
export type SwarmWorkerRun = z.infer<typeof swarmWorkerRunSchema>
export type SwarmTaskCreateInput = z.infer<typeof swarmTaskCreateInputSchema>
export type SwarmTaskUpdateInput = z.infer<typeof swarmTaskUpdateInputSchema>
export type SwarmRunStartInput = z.infer<typeof swarmRunStartInputSchema>
export type SwarmRunListInput = z.infer<typeof swarmRunListInputSchema>
