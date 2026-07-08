import { z } from "zod"

export const swarmRunModeSchema = z.enum(["batch", "continuous"])
export const swarmRunStatusSchema = z.enum(["running", "draining", "success", "partial", "failed", "cancelled"])
export const swarmWorkerRunStatusSchema = z.enum(["queued", "running", "success", "failed", "cancelled", "timeout"])
export const swarmTaskChangedReasonSchema = z.enum([
  "task-created",
  "task-updated",
  "task-deleted",
  "run-started",
  "run-draining",
  "run-cancelled",
  "run-finished",
  "run-failed",
  "worker-started",
  "worker-conversation",
  "worker-finished",
])
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

export const swarmFileWriteModeSchema = z.enum(["append-only", "update"])

export const swarmPromptInjectionSequenceBatchSchema = z.object({
  enabled: z.boolean().default(false),
}).strict()

export const swarmPromptInjectionPreviousHandoffSchema = z.object({
  enabled: z.boolean().default(false),
}).strict()

export const swarmPromptInjectionSummarySchema = z.object({
  enabled: z.boolean().default(false),
  injectRecent: z.boolean().default(false),
  recentLimit: z.number().int().min(1).max(20).default(3),
}).strict()

export const swarmPromptInjectionFileWriteSchema = z.object({
  enabled: z.boolean().default(false),
  path: z.string().max(4096).optional().default(""),
  mode: swarmFileWriteModeSchema.default("append-only"),
  lock: z.object({
    enabled: z.boolean().default(true),
  }).strict().default({ enabled: true }),
}).strict().superRefine((value, ctx) => {
  const normalizedPath = value.path.trim()
  if (value.enabled && !normalizedPath) {
    ctx.addIssue({
      code: "custom",
      path: ["path"],
      message: "file write path is required",
    })
    return
  }
  if (
    normalizedPath.startsWith("/")
    || /^[A-Za-z]:[\\/]/.test(normalizedPath)
    || normalizedPath.split(/[\\/]+/).includes("..")
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["path"],
      message: "file write path must stay inside the project",
    })
  }
})

export const swarmPromptInjectionConfigSchema = z.object({
  sequenceBatch: swarmPromptInjectionSequenceBatchSchema.default({ enabled: false }),
  previousHandoff: swarmPromptInjectionPreviousHandoffSchema.default({ enabled: false }),
  summary: swarmPromptInjectionSummarySchema.default({
    enabled: false,
    injectRecent: false,
    recentLimit: 3,
  }),
  fileWrite: swarmPromptInjectionFileWriteSchema.default({
    enabled: false,
    path: "",
    mode: "append-only",
    lock: { enabled: true },
  }),
  customAppendix: z.string().max(16 * 1024).optional().default(""),
}).strict()

export const swarmAgentConfigSchema = z.object({
  providerId: z.string().min(1).optional(),
  modelTier: z.string().min(1).optional(),
  permissionMode: z.string().min(1).optional(),
  mainThreadPersonaId: z.string().min(1).nullable().optional(),
}).strict()

const defaultSwarmPromptInjectionConfig = () => ({
  sequenceBatch: { enabled: false },
  previousHandoff: { enabled: false },
  summary: { enabled: false, injectRecent: false, recentLimit: 3 },
  fileWrite: {
    enabled: false,
    path: "",
    mode: "append-only" as const,
    lock: { enabled: true },
  },
  customAppendix: "",
})

const swarmTaskConfigRawSchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(1).max(256 * 1024),
  presetId: z.string().min(1).default("general"),
  promptInjection: swarmPromptInjectionConfigSchema.default(defaultSwarmPromptInjectionConfig),
  runMode: swarmRunModeSchema.default("batch"),
  concurrency: z.number().int().min(1).max(20).default(3),
  maxRounds: z.number().int().min(1).max(500).default(3),
  agent: swarmAgentConfigSchema.default({}),
}).strict()

const legacySwarmTaskConfigSchema = z.object({
  projectId: z.string().min(1),
  workspacePath: z.string().min(1).optional(),
  prompt: z.string().min(1).max(256 * 1024),
  presetId: z.string().min(1).default("general"),
  injectOptions: z.object({
    workerIdentity: z.boolean().default(false),
    roundContext: z.boolean().default(false),
    runContext: z.boolean().default(false),
    outputProtocol: z.boolean().optional(),
    parallelContext: z.boolean().default(false),
    gitContext: z.boolean().optional(),
    customAppendix: z.string().max(16 * 1024).optional().default(""),
  }).passthrough().optional(),
  runMode: swarmRunModeSchema.default("batch"),
  concurrency: z.number().int().min(1).max(20).default(3),
  maxRounds: z.number().int().min(1).max(500).default(3),
  output: z.object({
    mode: z.enum(["managed-directory", "target-file", "both"]).default("managed-directory"),
    managedDirectory: z.string().min(1).optional(),
    targetFile: z.string().min(1).optional(),
    targetFilePolicy: z.enum(["append-only", "section-update", "free-edit"]).default("append-only"),
  }).optional(),
  summary: z.object({
    enabled: z.boolean().default(false),
    injectRecent: z.boolean().default(false),
    recentLimit: z.number().int().min(1).max(20).default(3),
  }).strict().optional(),
  handoff: z.object({
    enabled: z.boolean().default(false),
  }).strict().optional(),
  summaryFile: z.object({
    enabled: z.boolean().default(false),
    path: z.string().max(4096).optional().default(""),
  }).strict().optional(),
  agent: swarmAgentConfigSchema.default({}),
}).passthrough()

export function normalizeSwarmTaskConfig(input: unknown): SwarmTaskConfig {
  const direct = swarmTaskConfigRawSchema.safeParse(input)
  if (direct.success) return direct.data
  if (hasOwnObjectKey(input, "promptInjection")) {
    return swarmTaskConfigRawSchema.parse(input)
  }

  const legacy = legacySwarmTaskConfigSchema.parse(input)
  const injectOptions = legacy.injectOptions
  const legacyTargetFile = legacy.output?.targetFile?.trim()
  const summaryFilePath = legacy.summaryFile?.path?.trim() || legacyTargetFile || ""
  const fileWriteEnabled = Boolean(
    legacy.summaryFile?.enabled
    || (legacyTargetFile && (legacy.output?.mode === "target-file" || legacy.output?.mode === "both")),
  )

  return swarmTaskConfigRawSchema.parse({
    projectId: legacy.projectId,
    prompt: legacy.prompt,
    presetId: legacy.presetId,
    promptInjection: {
      sequenceBatch: {
        enabled: Boolean(
          injectOptions?.workerIdentity
          || injectOptions?.roundContext
          || injectOptions?.runContext
          || injectOptions?.parallelContext,
        ),
      },
      previousHandoff: { enabled: Boolean(legacy.handoff?.enabled) },
      summary: {
        enabled: Boolean(legacy.summary?.enabled),
        injectRecent: Boolean(legacy.summary?.injectRecent),
        recentLimit: legacy.summary?.recentLimit ?? 3,
      },
      fileWrite: {
        enabled: fileWriteEnabled,
        path: summaryFilePath,
        mode: mapLegacyFileWriteMode(legacy.output?.targetFilePolicy),
        lock: { enabled: true },
      },
      customAppendix: injectOptions?.customAppendix ?? "",
    },
    runMode: legacy.runMode,
    concurrency: legacy.concurrency,
    maxRounds: legacy.maxRounds,
    agent: legacy.agent,
  })
}

function hasOwnObjectKey(input: unknown, key: string): boolean {
  return Boolean(input && typeof input === "object" && Object.hasOwn(input, key))
}

function mapLegacyFileWriteMode(value: "append-only" | "section-update" | "free-edit" | undefined): SwarmFileWriteMode {
  if (value === "section-update" || value === "free-edit") return "update"
  return "append-only"
}

function preprocessSwarmTaskConfig(input: unknown): unknown {
  try {
    return normalizeSwarmTaskConfig(input)
  } catch {
    return input
  }
}

export const swarmTaskConfigSchema = z.preprocess(preprocessSwarmTaskConfig, swarmTaskConfigRawSchema)

const swarmTaskConfigOverrideSchema = z.object({
  projectId: z.string().min(1).optional(),
  prompt: z.string().min(1).max(256 * 1024).optional(),
  presetId: z.string().min(1).optional(),
  promptInjection: z.object({
    sequenceBatch: z.object({
      enabled: z.boolean().optional(),
    }).strict().optional(),
    previousHandoff: z.object({
      enabled: z.boolean().optional(),
    }).strict().optional(),
    summary: z.object({
      enabled: z.boolean().optional(),
      injectRecent: z.boolean().optional(),
      recentLimit: z.number().int().min(1).max(20).optional(),
    }).strict().optional(),
    fileWrite: z.object({
      enabled: z.boolean().optional(),
      path: z.string().max(4096).optional(),
      mode: swarmFileWriteModeSchema.optional(),
      lock: z.object({
        enabled: z.boolean().optional(),
      }).strict().optional(),
    }).strict().optional(),
    customAppendix: z.string().max(16 * 1024).optional(),
  }).strict().optional(),
  runMode: swarmRunModeSchema.optional(),
  concurrency: z.number().int().min(1).max(20).optional(),
  maxRounds: z.number().int().min(1).max(500).optional(),
  agent: swarmAgentConfigSchema.partial().optional(),
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
  sequenceIndex: z.number().int().min(1).optional(),
  slotIndex: z.number().int().min(1).optional(),
  batchIndex: z.number().int().min(1).optional(),
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
  configOverride: swarmTaskConfigOverrideSchema.optional(),
}).strict()

export const swarmRunListInputSchema = z.object({
  taskId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict()

export const swarmTaskListResultSchema = z.array(swarmTaskSchema)
export const swarmRunListResultSchema = z.array(swarmRunSchema)
export const swarmWorkerRunListResultSchema = z.array(swarmWorkerRunSchema)

export const swarmTaskChangedEventPayloadSchema = z.object({
  taskId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  workerRunId: z.string().min(1).optional(),
  reason: swarmTaskChangedReasonSchema,
}).strict()

export const swarmTaskChangedDomainEventSchema = z.object({
  domain: z.literal("swarm-task"),
  type: z.literal("swarm-task.changed"),
  payload: swarmTaskChangedEventPayloadSchema,
  timestamp: z.string().min(1),
}).strict()

export type SwarmRunMode = z.infer<typeof swarmRunModeSchema>
export type SwarmRunStatus = z.infer<typeof swarmRunStatusSchema>
export type SwarmWorkerRunStatus = z.infer<typeof swarmWorkerRunStatusSchema>
export type SwarmTaskChangedReason = z.infer<typeof swarmTaskChangedReasonSchema>
export type SwarmTaskChangedEvent = z.infer<typeof swarmTaskChangedEventPayloadSchema>
export type SwarmWorkerPhase = z.infer<typeof swarmWorkerPhaseSchema>
export type SwarmFileWriteMode = z.infer<typeof swarmFileWriteModeSchema>
export type SwarmPromptInjectionConfig = z.infer<typeof swarmPromptInjectionConfigSchema>
export type SwarmTaskConfig = z.infer<typeof swarmTaskConfigRawSchema>
export type SwarmTask = z.infer<typeof swarmTaskSchema>
export type SwarmRun = z.infer<typeof swarmRunSchema>
export type SwarmWorkerRun = z.infer<typeof swarmWorkerRunSchema>
export type SwarmTaskCreateInput = z.infer<typeof swarmTaskCreateInputSchema>
export type SwarmTaskUpdateInput = z.infer<typeof swarmTaskUpdateInputSchema>
export type SwarmRunStartInput = z.infer<typeof swarmRunStartInputSchema>
export type SwarmRunListInput = z.infer<typeof swarmRunListInputSchema>
