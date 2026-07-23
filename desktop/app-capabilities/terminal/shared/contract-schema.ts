import { z } from "zod"

export const terminalLifecycleSchema = z.enum(["running", "stopping", "ended", "failed", "lost"])
export const terminalAttentionStateSchema = z.enum(["waiting", "not_waiting", "unknown"])
export const terminalAttentionKindSchema = z.enum([
  "shell_ready",
  "agent_question",
  "approval",
  "password",
  "other_interaction",
  "unknown",
])
export const terminalCreationSourceSchema = z.enum(["ui", "mcp", "legacy_unknown"])

export const terminalAttentionSchema = z.object({
  state: terminalAttentionStateSchema,
  kind: terminalAttentionKindSchema,
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
  detectedAt: z.string().datetime(),
  throughOutputSeq: z.number().int().nonnegative(),
  sizeRevision: z.number().int().nonnegative(),
  detectorId: z.string().min(1),
  detectorVersion: z.string().min(1),
}).strict()

export const terminalEndFactsSchema = z.object({
  cause: z.string().min(1),
  exitCode: z.number().int().nullable(),
  signal: z.number().int().nullable(),
  endedAt: z.string().datetime().nullable(),
  endTimeUnknown: z.boolean(),
  stopOperationId: z.string().min(1).optional(),
  requestedBy: z.string().min(1).optional(),
  requestedAt: z.string().datetime().optional(),
}).strict()

export const terminalLeaseSchema = z.object({
  leaseId: z.string().min(1),
  clientId: z.string().min(1),
  controllerInstanceId: z.string().min(1),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  leaseRevision: z.number().int().positive(),
}).strict()

export const terminalLeaseViewSchema = z.discriminatedUnion("occupied", [
  z.object({ occupied: z.literal(false), leaseRevision: z.number().int().nonnegative() }).strict(),
  z.object({
    occupied: z.literal(true),
    leaseRevision: z.number().int().positive(),
    own: z.literal(false),
    expiresAt: z.string().datetime(),
  }).strict(),
  z.object({
    occupied: z.literal(true),
    leaseRevision: z.number().int().positive(),
    own: z.literal(true),
    leaseId: z.string().min(1),
    acquiredAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  }).strict(),
])

export const terminalLaunchFactsSchema = z.object({
  shellKind: z.string().min(1),
  cwdKind: z.enum(["default", "group", "override", "legacy_unversioned"]),
  environmentKeys: z.array(z.string().min(1)).max(256),
  overriddenFields: z.array(z.enum(["cwd", "shell", "environment", "cols", "rows"])),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  legacyUnversioned: z.boolean(),
}).strict()

export const terminalSessionRecordSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  groupId: z.string().uuid(),
  title: z.string().min(1).max(120),
  cwd: z.string().min(1),
  shell: z.string().min(1),
  launchBodyRef: z.string().uuid().optional(),
  creationSource: terminalCreationSourceSchema,
  createdByClientId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime(),
  lifecycle: terminalLifecycleSchema,
  endFacts: terminalEndFactsSchema.optional(),
  metadataRevision: z.number().int().positive(),
  stateRevision: z.number().int().positive(),
  inputRevision: z.number().int().nonnegative(),
  inputHistoryBeforeBaselineUnknown: z.boolean(),
  sizeRevision: z.number().int().positive(),
  cols: z.number().int().positive().max(500),
  rows: z.number().int().positive().max(200),
  nextOutputSeq: z.number().int().positive(),
  firstRetainedOutputSeq: z.number().int().positive(),
  discardedOutputBytes: z.number().int().nonnegative(),
  discardedOutputChunks: z.number().int().nonnegative(),
  lastEvictedAt: z.string().datetime().optional(),
  launchRevisionApplied: z.number().int().positive().nullable(),
  commandId: z.string().uuid().optional(),
  commandRevisionApplied: z.number().int().positive().optional(),
  commandDeliveryOperationId: z.string().uuid().optional(),
  launchFacts: terminalLaunchFactsSchema,
  attention: terminalAttentionSchema,
}).strict()

export const terminalLaunchBodyRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  environment: z.record(z.string().min(1), z.string()),
  createdAt: z.string().datetime(),
}).strict()

export const terminalGroupRecordSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  name: z.string().min(1).max(80),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  sortOrder: z.number().int(),
  groupRevision: z.number().int().positive(),
  launchRevision: z.number().int().positive(),
  membershipRevision: z.number().int().positive(),
  commandCollectionRevision: z.number().int().positive(),
  defaultCwd: z.string().min(1).optional(),
  shell: z.string().min(1).optional(),
  launchBodyRef: z.string().uuid().optional(),
  environmentKeys: z.array(z.string().min(1)).max(256),
}).strict()

export const terminalGroupLaunchBodyRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  environment: z.record(z.string().min(1), z.string()),
  updatedAt: z.string().datetime(),
}).strict()

export const terminalCommandRecordSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().uuid(),
  commandId: z.string().uuid(),
  groupId: z.string().uuid(),
  name: z.string().min(1).max(80),
  commandRevision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  source: z.enum(["user", "legacy_startup_command"]),
  bodyRef: z.string().min(1).optional(),
  bodyByteLength: z.number().int().nonnegative(),
  bodyAvailable: z.boolean(),
}).strict()

export const terminalCommandBodyRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  commandId: z.string().uuid(),
  body: z.string().min(1).max(64 * 1024),
  updatedAt: z.string().datetime(),
}).strict()

export const terminalOperationSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().uuid(),
  operationId: z.string().uuid(),
  kind: z.enum(["stop", "force_stop", "delete", "command_delivery", "input", "resize"]),
  resourceType: z.enum(["session", "group"]),
  resourceId: z.string().uuid(),
  status: z.enum(["pending_delivery", "delivered", "delivery_uncertain", "completed", "failed"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  requestedBy: z.string().min(1),
  relatedOperationId: z.string().uuid().optional(),
  finalLifecycle: terminalLifecycleSchema.optional(),
  finalCause: z.string().min(1).optional(),
  errorCode: z.string().min(1).optional(),
  acceptedActionCount: z.number().int().nonnegative().optional(),
  acceptedBytes: z.number().int().nonnegative().optional(),
  failedActionIndex: z.number().int().nonnegative().optional(),
}).strict()

export const terminalIdempotencyRecordSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().min(1),
  clientId: z.string().min(1),
  capabilityId: z.string().min(1),
  idempotencyKey: z.string().min(16).max(200),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  operationId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  outcome: z.string().min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  result: z.record(z.string(), z.unknown()),
}).strict()

export const terminalDomainStateSchema = z.object({
  schemaVersion: z.literal(2),
  terminalDomainRevision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
}).strict()

export const terminalIdempotencyKeySchema = z.string().min(16).max(200)
export const terminalLimitSchema = z.number().int().positive().max(200).default(50)
export const terminalCursorSchema = z.string().min(1).max(4096)

export const terminalRequestBaseSchema = z.object({}).strict()

export const terminalPagedRequestSchema = z.object({
  limit: terminalLimitSchema.optional(),
  cursor: terminalCursorSchema.optional(),
}).strict()

export const terminalSessionTargetSchema = z.object({
  sessionId: z.string().uuid(),
}).strict()

export const terminalGroupTargetSchema = z.object({
  groupId: z.string().uuid(),
}).strict()

export const terminalGroupListInputSchema = terminalPagedRequestSchema.extend({
  name: z.string().min(1).max(80).optional(),
}).strict()

export const terminalGroupCreateInputSchema = z.object({
  name: z.string().min(1).max(80),
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalGroupRenameInputSchema = z.object({
  groupId: z.string().uuid(),
  name: z.string().min(1).max(80),
  expectedGroupRevision: z.number().int().positive(),
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalGroupLaunchUpdateInputSchema = z.object({
  groupId: z.string().uuid(),
  expectedLaunchRevision: z.number().int().positive(),
  settings: z.object({
    defaultCwd: z.string().min(1).nullable().optional(),
    shell: z.string().min(1).nullable().optional(),
    environment: z.record(z.string().min(1), z.string()).optional(),
  }).strict(),
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalGroupDeleteInputSchema = z.object({
  groupId: z.string().uuid(),
  expectedGroupRevision: z.number().int().positive(),
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalGroupDeletePreviewInputSchema = z.object({
  groupId: z.string().uuid(),
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalGroupDeleteCommitInputSchema = z.object({
  deletePlanId: z.string().uuid(),
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalGroupCommandListInputSchema = terminalPagedRequestSchema.extend({
  groupId: z.string().uuid(),
}).strict()

export const terminalGroupCommandTargetSchema = z.object({
  groupId: z.string().uuid(),
  commandId: z.string().uuid(),
}).strict()

const terminalSavedCommandBodySchema = z.string().min(1).max(64 * 1024)

export const terminalGroupCommandCreateInputSchema = z.object({
  groupId: z.string().uuid(),
  expectedCommandCollectionRevision: z.number().int().positive(),
  name: z.string().min(1).max(80),
  command: terminalSavedCommandBodySchema,
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalGroupCommandUpdateInputSchema = z.object({
  groupId: z.string().uuid(),
  commandId: z.string().uuid(),
  expectedCommandRevision: z.number().int().positive(),
  name: z.string().min(1).max(80),
  command: terminalSavedCommandBodySchema,
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalGroupCommandDeleteInputSchema = z.object({
  groupId: z.string().uuid(),
  commandId: z.string().uuid(),
  expectedCommandRevision: z.number().int().positive(),
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalGroupCommandLaunchInputSchema = z.object({
  groupId: z.string().uuid(),
  commandId: z.string().uuid(),
  expectedLaunchRevision: z.number().int().positive(),
  expectedCommandRevision: z.number().int().positive(),
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalSessionListInputSchema = terminalPagedRequestSchema.extend({
  groupId: z.string().uuid().optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  creationSource: terminalCreationSourceSchema.optional(),
  title: z.string().min(1).max(120).optional(),
}).strict()

export const terminalSessionStateListInputSchema = terminalSessionListInputSchema.extend({
  lifecycle: terminalLifecycleSchema.optional(),
}).strict()

export const terminalSessionRenameInputSchema = z.object({
  sessionId: z.string().uuid(),
  title: z.string().min(1).max(120),
  expectedMetadataRevision: z.number().int().positive(),
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalViewInputSchema = z.object({
  sessionId: z.string().uuid(),
  kind: z.enum(["screen", "scrollback"]),
  tailLines: z.number().int().positive().max(2_000).optional(),
  cursor: terminalCursorSchema.optional(),
  maxBytes: z.number().int().positive().max(1024 * 1024).default(256 * 1024),
}).strict()

export const terminalOperationGetInputSchema = z.object({
  sessionId: z.string().uuid(),
  operationId: z.string().uuid(),
}).strict()

export const terminalCreateSessionInputSchema = z.object({
  groupId: z.string().uuid().optional(),
  expectedLaunchRevision: z.number().int().positive().optional(),
  title: z.string().min(1).max(120).optional(),
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalCreateSessionOverrideInputSchema = z.object({
  groupId: z.string().uuid().optional(),
  expectedLaunchRevision: z.number().int().positive().optional(),
  title: z.string().min(1).max(120).optional(),
  overrides: z.object({
    cwd: z.string().min(1).optional(),
    shell: z.string().min(1).optional(),
    environment: z.record(z.string().min(1), z.string()).optional(),
    cols: z.number().int().min(2).max(500).optional(),
    rows: z.number().int().min(1).max(200).optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, "At least one override is required"),
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict().superRefine((value, context) => {
  if (value.groupId && value.expectedLaunchRevision === undefined) {
    context.addIssue({ code: "custom", message: "expectedLaunchRevision is required with groupId" })
  }
  if (!value.groupId && value.expectedLaunchRevision !== undefined) {
    context.addIssue({ code: "custom", message: "expectedLaunchRevision requires groupId" })
  }
})

export const terminalAcquireControlInputSchema = z.object({
  sessionId: z.string().uuid(),
  requestedLeaseMs: z.number().int().min(1_000).max(60_000),
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalLeaseOperationInputSchema = z.object({
  sessionId: z.string().uuid(),
  leaseId: z.string().uuid(),
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalRenewControlInputSchema = terminalLeaseOperationInputSchema.extend({
  requestedLeaseMs: z.number().int().min(1_000).max(60_000),
}).strict()

export const terminalSemanticKeySchema = z.enum([
  "Enter",
  "Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Backspace",
  "Ctrl+C",
  "Ctrl+D",
])

export const terminalSemanticActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(64 * 1024) }).strict(),
  z.object({ type: z.literal("key"), key: terminalSemanticKeySchema }).strict(),
])

const terminalInputBase = {
  sessionId: z.string().uuid(),
  leaseId: z.string().uuid(),
  expectedInputRevision: z.number().int().nonnegative(),
  idempotencyKey: terminalIdempotencyKeySchema,
}

export const terminalSemanticInputSchema = z.object({
  ...terminalInputBase,
  actions: z.array(terminalSemanticActionSchema).min(1).max(128),
}).strict()

export const terminalCommandInputSchema = z.object({
  ...terminalInputBase,
  text: z.string().min(1).max(64 * 1024),
}).strict()

export const terminalPasteInputSchema = z.object({
  ...terminalInputBase,
  expectedThroughOutputSeq: z.number().int().nonnegative(),
  text: z.string().min(1).max(256 * 1024),
}).strict()

export const terminalRawInputSchema = z.object({
  ...terminalInputBase,
  dataBase64: z.string().min(1).max(512 * 1024),
}).strict()

export const terminalResizeInputSchema = z.object({
  sessionId: z.string().uuid(),
  leaseId: z.string().uuid(),
  expectedSizeRevision: z.number().int().positive(),
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(200),
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalReadOutputInputSchema = z.object({
  sessionId: z.string().uuid(),
  afterOutputSeq: z.number().int().nonnegative().default(0),
  limitBytes: z.number().int().positive().max(1024 * 1024).default(256 * 1024),
}).strict()

export const terminalObserveInputSchema = z.object({
  sessionId: z.string().uuid(),
  afterStateRevision: z.number().int().nonnegative(),
  afterOutputSeq: z.number().int().nonnegative(),
  maxWaitMs: z.number().int().min(0).max(30_000),
  limitBytes: z.number().int().positive().max(1024 * 1024).optional(),
}).strict()

export const terminalStopInputSchema = z.object({
  sessionId: z.string().uuid(),
  idempotencyKey: terminalIdempotencyKeySchema,
}).strict()

export const terminalDeleteSessionInputSchema = terminalStopInputSchema

export type TerminalLifecycle = z.infer<typeof terminalLifecycleSchema>
export type TerminalAttention = z.infer<typeof terminalAttentionSchema>
export type TerminalEndFacts = z.infer<typeof terminalEndFactsSchema>
export type TerminalLease = z.infer<typeof terminalLeaseSchema>
export type TerminalSessionRecord = z.infer<typeof terminalSessionRecordSchema>
export type TerminalLaunchBodyRecord = z.infer<typeof terminalLaunchBodyRecordSchema>
export type TerminalGroupRecord = z.infer<typeof terminalGroupRecordSchema>
export type TerminalGroupLaunchBodyRecord = z.infer<typeof terminalGroupLaunchBodyRecordSchema>
export type TerminalCommandRecord = z.infer<typeof terminalCommandRecordSchema>
export type TerminalCommandBodyRecord = z.infer<typeof terminalCommandBodyRecordSchema>
export type TerminalOperation = z.infer<typeof terminalOperationSchema>
export type TerminalIdempotencyRecord = z.infer<typeof terminalIdempotencyRecordSchema>
export type TerminalDomainState = z.infer<typeof terminalDomainStateSchema>
export type TerminalSemanticAction = z.infer<typeof terminalSemanticActionSchema>
export type TerminalCreateSessionInput = z.infer<typeof terminalCreateSessionInputSchema>
export type TerminalCreateSessionOverrideInput = z.infer<typeof terminalCreateSessionOverrideInputSchema>
export type TerminalAcquireControlInput = z.infer<typeof terminalAcquireControlInputSchema>
export type TerminalRenewControlInput = z.infer<typeof terminalRenewControlInputSchema>
export type TerminalLeaseOperationInput = z.infer<typeof terminalLeaseOperationInputSchema>
export type TerminalSemanticInput = z.infer<typeof terminalSemanticInputSchema>
export type TerminalCommandInput = z.infer<typeof terminalCommandInputSchema>
export type TerminalPasteInput = z.infer<typeof terminalPasteInputSchema>
export type TerminalRawInput = z.infer<typeof terminalRawInputSchema>
export type TerminalResizeInput = z.infer<typeof terminalResizeInputSchema>
export type TerminalReadOutputInput = z.infer<typeof terminalReadOutputInputSchema>
export type TerminalObserveInput = z.infer<typeof terminalObserveInputSchema>
export type TerminalStopInput = z.infer<typeof terminalStopInputSchema>
