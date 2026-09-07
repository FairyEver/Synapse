import { z } from "zod"
import { terminalLaunchFactsSchema } from "./contract-schema"

export {
  TERMINAL_WORKSPACE_PANE_LIMIT,
  collectTerminalPaneLeaves,
  findTerminalPane,
  findTerminalPaneSplitPath,
  moveTerminalPane,
  removeTerminalPane,
  setTerminalSplitRatio,
  splitTerminalPane,
  terminalClosePaneInputSchema,
  terminalCloseWorkspaceInputSchema,
  terminalCloseWorkspaceResultSchema,
  terminalLayoutNodeSchema,
  terminalMovePaneInputSchema,
  terminalPaneDropEdgeSchema,
  terminalPaneLeafSchema,
  terminalRenameWorkspaceInputSchema,
  terminalSetSplitRatioInputSchema,
  terminalSplitPaneInputSchema,
  terminalSplitPaneResultSchema,
  terminalWorkspaceIdInputSchema,
  terminalWorkspaceSchema,
  type TerminalClosePaneInput,
  type TerminalCloseWorkspaceInput,
  type TerminalCloseWorkspaceResult,
  type TerminalLayoutNode,
  type TerminalMovePaneInput,
  type TerminalPaneDropEdge,
  type TerminalPaneLeaf,
  type TerminalPaneSplitPathEntry,
  type TerminalRenameWorkspaceInput,
  type TerminalSetSplitRatioInput,
  type TerminalSplitNode,
  type TerminalSplitPaneInput,
  type TerminalSplitPaneResult,
  type TerminalWorkspace,
} from "./workspace"

export const terminalSessionStatusSchema = z.enum(["running", "stopping", "ended", "failed", "lost"])

export const terminalEnvironmentSchema = z.record(
  z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  z.string().nullable(),
)

export const terminalEnvironmentEntrySchema = z.discriminatedUnion("action", [
  z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), action: z.literal("set"), value: z.string() }).strict(),
  z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), action: z.literal("unset") }).strict(),
])

export const terminalLaunchLayerSchema = z.object({
  defaultCwd: z.string().min(1).optional(),
  shell: z.string().min(1).optional(),
  environment: terminalEnvironmentSchema.optional(),
}).strict()

export const terminalGlobalLaunchSettingsSchema = z.object({
  revision: z.number().int().positive().default(1),
  updatedAt: z.string().min(1),
  settings: terminalLaunchLayerSchema.optional(),
}).strict()

export const terminalAgentNotificationSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal("default"),
  enabled: z.boolean(),
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime(),
}).strict()

export const terminalUpdateAgentNotificationSettingsInputSchema = z.object({
  enabled: z.boolean(),
  expectedRevision: z.number().int().positive(),
}).strict()

export const terminalReportActiveSessionInputSchema = z.object({
  sessionId: z.string().uuid().nullable(),
}).strict()

export const TERMINAL_CUSTOM_TOOLBAR_ACTION_LABEL_MAX_LENGTH = 32
export const TERMINAL_CUSTOM_TOOLBAR_ACTION_CONTENT_MAX_LENGTH = 4 * 1024

const terminalToolbarActionLabelSchema = z.string().trim().min(1).max(TERMINAL_CUSTOM_TOOLBAR_ACTION_LABEL_MAX_LENGTH)
const terminalToolbarActionContentSchema = z.string()
  .trim()
  .min(1)
  .max(TERMINAL_CUSTOM_TOOLBAR_ACTION_CONTENT_MAX_LENGTH)
  .refine((value) => !/[\r\n]/.test(value), "Terminal toolbar action content must be a single line")

export const TERMINAL_CUSTOM_TOOLBAR_ACTION_LIMIT = 50

export const terminalCustomToolbarActionSchema = z.object({
  id: z.string().uuid(),
  label: terminalToolbarActionLabelSchema,
  content: terminalToolbarActionContentSchema,
  pressEnter: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  actionRevision: z.number().int().positive().default(1),
}).strict()

export const terminalCreateCustomToolbarActionInputSchema = z.object({
  label: terminalToolbarActionLabelSchema,
  content: terminalToolbarActionContentSchema,
  pressEnter: z.boolean(),
}).strict()

export const terminalUpdateCustomToolbarActionInputSchema = terminalCreateCustomToolbarActionInputSchema.extend({
  id: z.string().uuid(),
}).strict()

export const terminalDeleteCustomToolbarActionInputSchema = z.object({
  id: z.string().uuid(),
}).strict()

export const terminalGroupCommandSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  command: z.string().min(1).max(64 * 1024),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  commandRevision: z.number().int().positive().default(1),
  launch: terminalLaunchLayerSchema.optional(),
}).strict()

export const terminalGroupCommandSummarySchema = terminalGroupCommandSchema.omit({
  command: true,
  launch: true,
})

export const terminalGroupSettingsSchema = terminalLaunchLayerSchema.extend({
  commands: z.array(terminalGroupCommandSchema).optional(),
  startupCommand: z.string().min(1).max(64 * 1024).optional(),
}).strict()

export const terminalGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  sortOrder: z.number().int(),
  settings: terminalGroupSettingsSchema.optional(),
  groupRevision: z.number().int().positive().default(1),
  launchRevision: z.number().int().positive().default(1),
  membershipRevision: z.number().int().positive().default(1),
  commandCollectionRevision: z.number().int().positive().default(1),
})

export const terminalGroupListItemSchema = terminalGroupSchema.omit({ settings: true }).extend({
  settings: z.object({
    commands: z.array(terminalGroupCommandSummarySchema).optional(),
  }).strict().optional(),
}).strict()

export const terminalSessionSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
  title: z.string().min(1),
  cwd: z.string().min(1),
  shell: z.string().min(1),
  status: terminalSessionStatusSchema,
  exitCode: z.number().int().optional(),
  signal: z.number().int().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1).optional(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  lastOutputSeq: z.number().int().nonnegative(),
  metadataRevision: z.number().int().positive().default(1),
  stateRevision: z.number().int().positive().default(1),
  inputRevision: z.number().int().nonnegative().default(0),
  sizeRevision: z.number().int().positive().default(1),
  attention: z.object({
    state: z.enum(["waiting", "not_waiting", "unknown"]),
    kind: z.enum(["shell_ready", "agent_question", "approval", "password", "other_interaction", "unknown"]),
    reason: z.string().min(1),
    confidence: z.number().min(0).max(1),
    detectedAt: z.string().min(1),
    throughOutputSeq: z.number().int().nonnegative(),
    sizeRevision: z.number().int().positive(),
    detectorId: z.string().min(1),
    detectorVersion: z.string().min(1),
  }).default({
    state: "unknown",
    kind: "unknown",
    reason: "insufficient_evidence",
    confidence: 0,
    detectedAt: new Date(0).toISOString(),
    throughOutputSeq: 0,
    sizeRevision: 1,
    detectorId: "passive-terminal-v1",
    detectorVersion: "1.0.0",
  }),
  creationSource: z.enum(["ui", "mcp", "legacy_unknown"]).default("legacy_unknown"),
  createdByClientId: z.string().min(1).optional(),
  endCause: z.string().min(1).optional(),
  stopOperationId: z.string().min(1).optional(),
  stopRequestedBy: z.string().min(1).optional(),
  stopRequestedAt: z.string().min(1).optional(),
  endTimeUnknown: z.boolean().default(false),
  inputHistoryBeforeBaselineUnknown: z.boolean().default(false),
  launchRevisionApplied: z.number().int().positive().nullable().default(null),
  globalLaunchRevisionApplied: z.number().int().positive().nullable().default(null),
  commandId: z.string().min(1).optional(),
  commandRevisionApplied: z.number().int().positive().optional(),
  commandDeliveryOperationId: z.string().min(1).optional(),
  discardedOutputBytes: z.number().int().nonnegative().default(0),
  discardedOutputChunks: z.number().int().nonnegative().default(0),
  lastEvictedAt: z.string().min(1).optional(),
  launchEnvironment: z.record(z.string().min(1), z.string()).optional(),
  launchFacts: terminalLaunchFactsSchema.optional(),
})

export const terminalOutputChunkSchema = z.object({
  sessionId: z.string().min(1),
  seq: z.number().int().positive(),
  data: z.string(),
  createdAt: z.string().min(1),
  source: z.literal("pty"),
})

export const terminalCreateGroupInputSchema = z.object({
  name: z.string().min(1).max(80),
}).strict()

export const terminalGroupIdInputSchema = z.object({
  groupId: z.string().min(1),
}).strict()

export const terminalRenameGroupInputSchema = z.object({
  groupId: z.string().min(1),
  name: z.string().min(1).max(80),
}).strict()

export const terminalUpdateGroupSettingsInputSchema = z.object({
  groupId: z.string().min(1),
  name: z.string().min(1).max(80),
  expectedLaunchRevision: z.number().int().positive().optional(),
  settings: terminalGroupSettingsSchema.optional(),
}).strict()

export const terminalUpdateGlobalLaunchSettingsInputSchema = z.object({
  expectedRevision: z.number().int().positive(),
  settings: terminalLaunchLayerSchema.optional(),
}).strict()

export const terminalEnvironmentValueInputSchema = z.object({
  scope: z.enum(["global", "group", "command"]),
  groupId: z.string().min(1).optional(),
  commandId: z.string().min(1).optional(),
  key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  draftValue: z.string().optional(),
}).strict()

export const terminalCreateGroupCommandInputSchema = z.object({
  groupId: z.string().min(1),
  expectedCommandCollectionRevision: z.number().int().positive().optional(),
  name: z.string().min(1).max(80),
  command: z.string().min(1).max(64 * 1024),
  launch: terminalLaunchLayerSchema.optional(),
}).strict()

export const terminalUpdateGroupCommandInputSchema = z.object({
  groupId: z.string().min(1),
  commandId: z.string().min(1),
  expectedCommandRevision: z.number().int().positive().optional(),
  name: z.string().min(1).max(80),
  command: z.string().min(1).max(64 * 1024),
  launch: terminalLaunchLayerSchema.optional(),
}).strict()

export const terminalGroupCommandIdInputSchema = z.object({
  groupId: z.string().min(1),
  commandId: z.string().min(1),
}).strict()

export const terminalDeleteGroupCommandInputSchema = terminalGroupCommandIdInputSchema

export const terminalLaunchGroupCommandInputSchema = z.object({
  groupId: z.string().min(1),
  commandId: z.string().min(1),
  cols: z.number().int().positive().max(500).optional(),
  rows: z.number().int().positive().max(200).optional(),
}).strict()

export const terminalDeleteGroupInputSchema = terminalGroupIdInputSchema

export const terminalEmptyInputSchema = z.object({}).strict()

export const terminalCreateSessionInputSchema = z.object({
  groupId: z.string().min(1).optional(),
  title: z.string().min(1).max(120).optional(),
  cwd: z.string().min(1).optional(),
  cols: z.number().int().positive().max(500).optional(),
  rows: z.number().int().positive().max(200).optional(),
}).strict()

export const terminalSessionIdInputSchema = z.object({
  sessionId: z.string().min(1),
}).strict()

export const terminalAttachSessionInputSchema = terminalSessionIdInputSchema

export const terminalRenameSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).max(120),
}).strict()

export const terminalDeleteSessionInputSchema = z.object({
  sessionId: z.string().min(1),
}).strict()

export const terminalReadSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  afterSeq: z.number().int().nonnegative().optional(),
  limitBytes: z.number().int().positive().max(1024 * 1024).optional(),
}).strict()

export const terminalWriteSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  data: z.string().min(1).max(64 * 1024),
}).strict()

export const terminalResizeSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  cols: z.number().int().positive().max(500),
  rows: z.number().int().positive().max(200),
}).strict()

export const terminalStopSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  force: z.boolean().optional(),
}).strict()

export const terminalRunStartupCommandInputSchema = terminalSessionIdInputSchema

export const terminalReadSessionResultSchema = z.object({
  session: terminalSessionSchema,
  chunks: z.array(terminalOutputChunkSchema),
  nextSeq: z.number().int().nonnegative(),
  truncated: z.boolean(),
  firstSeq: z.number().int().nonnegative(),
  gap: z.boolean().default(false),
  hasMore: z.boolean().default(false),
  discardedBytes: z.number().int().nonnegative().default(0),
  discardedChunks: z.number().int().nonnegative().default(0),
})

const terminalRendererSnapshotBaseSchema = z.object({
  session: terminalSessionSchema,
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  throughOutputSeq: z.number().int().nonnegative(),
  sizeRevision: z.number().int().positive(),
  emulatorId: z.literal("xterm-headless"),
  emulatorVersion: z.literal("6.0.0"),
})

export const terminalAttachSessionResultSchema = z.discriminatedUnion("degraded", [
  terminalRendererSnapshotBaseSchema.extend({
    degraded: z.literal(false),
    serialized: z.string(),
    scrollbackTruncated: z.boolean(),
    reasons: z.array(z.string()).length(0),
  }).strict(),
  terminalRendererSnapshotBaseSchema.extend({
    degraded: z.literal(true),
    serialized: z.null(),
    scrollbackTruncated: z.boolean(),
    reasons: z.array(z.string().min(1)).min(1),
  }).strict(),
])

export const terminalResizedEventSchema = z.object({
  sessionId: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  sizeRevision: z.number().int().positive(),
  throughOutputSeq: z.number().int().nonnegative(),
}).strict()

export type TerminalGroup = z.infer<typeof terminalGroupSchema>
export type TerminalGroupListItem = z.infer<typeof terminalGroupListItemSchema>
export type TerminalEnvironment = z.infer<typeof terminalEnvironmentSchema>
export type TerminalEnvironmentEntry = z.infer<typeof terminalEnvironmentEntrySchema>
export type TerminalLaunchLayer = z.infer<typeof terminalLaunchLayerSchema>
export type TerminalGlobalLaunchSettings = z.infer<typeof terminalGlobalLaunchSettingsSchema>
export type TerminalAgentNotificationSettings = z.infer<typeof terminalAgentNotificationSettingsSchema>
export type TerminalCustomToolbarAction = z.infer<typeof terminalCustomToolbarActionSchema>
export type TerminalCreateCustomToolbarActionInput = z.infer<typeof terminalCreateCustomToolbarActionInputSchema>
export type TerminalUpdateCustomToolbarActionInput = z.infer<typeof terminalUpdateCustomToolbarActionInputSchema>
export type TerminalDeleteCustomToolbarActionInput = z.infer<typeof terminalDeleteCustomToolbarActionInputSchema>
export type TerminalGroupSettings = z.infer<typeof terminalGroupSettingsSchema>
export type TerminalGroupCommand = z.infer<typeof terminalGroupCommandSchema>
export type TerminalGroupCommandSummary = z.infer<typeof terminalGroupCommandSummarySchema>
export type TerminalSession = z.infer<typeof terminalSessionSchema>
export type TerminalOutputChunk = z.infer<typeof terminalOutputChunkSchema>
export type TerminalCreateGroupInput = z.infer<typeof terminalCreateGroupInputSchema>
export type TerminalRenameGroupInput = z.infer<typeof terminalRenameGroupInputSchema>
export type TerminalUpdateGroupSettingsInput = z.infer<typeof terminalUpdateGroupSettingsInputSchema>
export type TerminalUpdateGlobalLaunchSettingsInput = z.infer<typeof terminalUpdateGlobalLaunchSettingsInputSchema>
export type TerminalUpdateAgentNotificationSettingsInput = z.infer<typeof terminalUpdateAgentNotificationSettingsInputSchema>
export type TerminalEnvironmentValueInput = z.infer<typeof terminalEnvironmentValueInputSchema>
export type TerminalCreateGroupCommandInput = z.infer<typeof terminalCreateGroupCommandInputSchema>
export type TerminalUpdateGroupCommandInput = z.infer<typeof terminalUpdateGroupCommandInputSchema>
export type TerminalDeleteGroupCommandInput = z.infer<typeof terminalDeleteGroupCommandInputSchema>
export type TerminalLaunchGroupCommandInput = z.infer<typeof terminalLaunchGroupCommandInputSchema>
export type TerminalDeleteGroupInput = z.infer<typeof terminalDeleteGroupInputSchema>
export type TerminalEmptyInput = z.infer<typeof terminalEmptyInputSchema>
export type TerminalCreateSessionInput = z.infer<typeof terminalCreateSessionInputSchema>
export type TerminalRenameSessionInput = z.infer<typeof terminalRenameSessionInputSchema>
export type TerminalDeleteSessionInput = z.infer<typeof terminalDeleteSessionInputSchema>
export type TerminalReadSessionInput = z.infer<typeof terminalReadSessionInputSchema>
export type TerminalWriteSessionInput = z.infer<typeof terminalWriteSessionInputSchema>
export type TerminalResizeSessionInput = z.infer<typeof terminalResizeSessionInputSchema>
export type TerminalStopSessionInput = z.infer<typeof terminalStopSessionInputSchema>
export type TerminalRunStartupCommandInput = z.infer<typeof terminalRunStartupCommandInputSchema>
export type TerminalReadSessionResult = z.infer<typeof terminalReadSessionResultSchema>
export type TerminalAttachSessionInput = z.infer<typeof terminalAttachSessionInputSchema>
export type TerminalAttachSessionResult = z.infer<typeof terminalAttachSessionResultSchema>
export type TerminalResizedEvent = z.infer<typeof terminalResizedEventSchema>
