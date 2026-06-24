import { z } from "zod"

export const terminalSessionStatusSchema = z.enum(["running", "exited", "killed", "failed", "lost"])
export const terminalAgentControlSchema = z.enum(["disabled", "enabled"])

export const terminalGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  sortOrder: z.number().int(),
})

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
  agentControl: terminalAgentControlSchema,
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  lastOutputSeq: z.number().int().nonnegative(),
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

export const terminalCreateSessionInputSchema = z.object({
  groupId: z.string().min(1).optional(),
  title: z.string().min(1).max(120).optional(),
  cwd: z.string().min(1).optional(),
  cols: z.number().int().positive().max(500).optional(),
  rows: z.number().int().positive().max(200).optional(),
  agentControl: z.boolean().optional(),
}).strict()

export const terminalSessionIdInputSchema = z.object({
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

export const terminalReadSessionResultSchema = z.object({
  session: terminalSessionSchema,
  chunks: z.array(terminalOutputChunkSchema),
  nextSeq: z.number().int().nonnegative(),
  truncated: z.boolean(),
  firstSeq: z.number().int().nonnegative(),
})

export type TerminalGroup = z.infer<typeof terminalGroupSchema>
export type TerminalSession = z.infer<typeof terminalSessionSchema>
export type TerminalOutputChunk = z.infer<typeof terminalOutputChunkSchema>
export type TerminalCreateGroupInput = z.infer<typeof terminalCreateGroupInputSchema>
export type TerminalCreateSessionInput = z.infer<typeof terminalCreateSessionInputSchema>
export type TerminalReadSessionInput = z.infer<typeof terminalReadSessionInputSchema>
export type TerminalWriteSessionInput = z.infer<typeof terminalWriteSessionInputSchema>
export type TerminalResizeSessionInput = z.infer<typeof terminalResizeSessionInputSchema>
export type TerminalStopSessionInput = z.infer<typeof terminalStopSessionInputSchema>
export type TerminalReadSessionResult = z.infer<typeof terminalReadSessionResultSchema>
