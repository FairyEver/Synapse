import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { terminalOperationSchema } from "../shared/contract-schema"
import {
  terminalCustomToolbarActionSchema,
  terminalGlobalLaunchSettingsSchema,
  terminalGroupSchema,
  terminalOutputChunkSchema,
  terminalSessionSchema,
  type TerminalGroup,
  type TerminalGlobalLaunchSettings,
  type TerminalOutputChunk,
  type TerminalSession,
} from "../shared/schema"
import { terminalWorkspaceSchema, type TerminalWorkspace } from "../shared/workspace"

export const terminalStoreStateSchema = z.object({
  globalLaunch: terminalGlobalLaunchSettingsSchema.default({
    revision: 1,
    updatedAt: new Date(0).toISOString(),
  }),
  toolbarActions: z.array(terminalCustomToolbarActionSchema).default([]),
  groups: z.array(terminalGroupSchema),
  workspaces: z.array(terminalWorkspaceSchema).default([]),
  sessions: z.array(terminalSessionSchema),
  output: z.array(terminalOutputChunkSchema),
  terminalDomainRevision: z.number().int().nonnegative().default(0),
  operations: z.array(terminalOperationSchema).default([]),
  idempotency: z.array(z.object({
    scope: z.string().min(1),
    clientId: z.string().min(1),
    capability: z.string().min(1),
    idempotencyKey: z.string().min(1),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAtMs: z.number().int().positive(),
    result: z.unknown(),
  }).strict()).default([]),
  checkpoints: z.array(z.object({
    sessionId: z.string().min(1),
    throughOutputSeq: z.number().int().nonnegative(),
    sizeRevision: z.number().int().positive(),
    emulatorId: z.literal("xterm-headless"),
    emulatorVersion: z.literal("6.0.0"),
    serialized: z.string(),
  }).strict()).default([]),
})

export type TerminalStoreState = z.infer<typeof terminalStoreStateSchema>

export type TerminalRuntimeStoreSessionUpdate = {
  readonly session: TerminalSession
  readonly output: TerminalOutputChunk[]
  readonly firstRetainedOutputSeq: number
  readonly checkpoint?: TerminalStoreState["checkpoints"][number]
}

export type TerminalRuntimeStoreUpdate = {
  readonly sessions: TerminalRuntimeStoreSessionUpdate[]
}

export type TerminalStore = {
  loadState(): Promise<TerminalStoreState>
  saveState(state: {
    globalLaunch: TerminalGlobalLaunchSettings
    toolbarActions?: TerminalStoreState["toolbarActions"]
    groups: TerminalGroup[]
    workspaces?: TerminalWorkspace[]
    sessions: TerminalSession[]
    output: TerminalOutputChunk[]
    terminalDomainRevision?: number
    operations?: TerminalStoreState["operations"]
    idempotency?: TerminalStoreState["idempotency"]
    checkpoints?: TerminalStoreState["checkpoints"]
  }): Promise<void>
  saveRuntimeState?(update: TerminalRuntimeStoreUpdate): Promise<void>
  readonly persistenceProtection?: "available" | "unavailable" | "degraded"
}

export function createTerminalStore(options: { baseDir: string }): TerminalStore {
  const filePath = path.join(options.baseDir, "terminal-state.json")

  return {
    async loadState() {
      try {
        const raw = await readFile(filePath, "utf8")
        return parseTerminalStoreState(JSON.parse(raw))
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          return {
            globalLaunch: { revision: 1, updatedAt: new Date(0).toISOString() },
            toolbarActions: [],
            groups: [],
            workspaces: [],
            sessions: [],
            output: [],
            terminalDomainRevision: 0,
            operations: [],
            idempotency: [],
            checkpoints: [],
          }
        }
        throw error
      }
    },
    async saveState(state) {
      const parsed = parseTerminalStoreState(state)
      const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
      await mkdir(options.baseDir, { recursive: true })
      try {
        await writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
        await rename(tempPath, filePath)
      } catch (error) {
        await unlink(tempPath).catch(() => undefined)
        throw error
      }
    },
  }
}

function parseTerminalStoreState(state: unknown): TerminalStoreState {
  const parsed = terminalStoreStateSchema.parse(state)
  validateTerminalStoreState(parsed)
  return parsed
}

function validateTerminalStoreState(state: TerminalStoreState): void {
  const groupIds = new Set<string>()
  for (const group of state.groups) {
    if (groupIds.has(group.id)) {
      throw new Error(`Duplicate terminal group id: ${group.id}`)
    }
    groupIds.add(group.id)
  }

  const sessionIds = new Set<string>()
  const sessionGroups = new Map<string, string>()
  for (const session of state.sessions) {
    if (sessionIds.has(session.id)) {
      throw new Error(`Duplicate terminal session id: ${session.id}`)
    }
    if (!groupIds.has(session.groupId)) {
      throw new Error(`Unknown terminal session group: ${session.groupId}`)
    }
    sessionIds.add(session.id)
    sessionGroups.set(session.id, session.groupId)
  }

  const workspaceIds = new Set<string>()
  const assignedSessionIds = new Set<string>()
  const paneIds = new Set<string>()
  const splitIds = new Set<string>()
  for (const workspace of state.workspaces) {
    if (workspaceIds.has(workspace.id)) throw new Error(`Duplicate terminal workspace id: ${workspace.id}`)
    if (!groupIds.has(workspace.groupId)) throw new Error(`Unknown terminal workspace group: ${workspace.groupId}`)
    workspaceIds.add(workspace.id)
    const workspacePanes = collectWorkspacePanes(workspace.layout)
    const workspacePaneIds = new Set(workspacePanes.map((pane) => pane.paneId))
    if (new Set(workspace.closingPaneIds).size !== workspace.closingPaneIds.length) {
      throw new Error(`Duplicate closing terminal pane in workspace: ${workspace.id}`)
    }
    for (const pane of workspacePanes) {
      if (!sessionIds.has(pane.sessionId)) throw new Error(`Unknown terminal workspace session: ${pane.sessionId}`)
      if (sessionGroups.get(pane.sessionId) !== workspace.groupId) {
        throw new Error(`Terminal workspace session belongs to another group: ${pane.sessionId}`)
      }
      if (assignedSessionIds.has(pane.sessionId)) throw new Error(`Duplicate terminal workspace session: ${pane.sessionId}`)
      if (paneIds.has(pane.paneId)) throw new Error(`Duplicate terminal pane id: ${pane.paneId}`)
      assignedSessionIds.add(pane.sessionId)
      paneIds.add(pane.paneId)
    }
    for (const splitId of collectWorkspaceSplitIds(workspace.layout)) {
      if (splitIds.has(splitId)) throw new Error(`Duplicate terminal split id: ${splitId}`)
      splitIds.add(splitId)
    }
    for (const closingPaneId of workspace.closingPaneIds) {
      if (!workspacePaneIds.has(closingPaneId)) throw new Error(`Unknown closing terminal pane: ${closingPaneId}`)
    }
  }

  const outputSeqBySession = new Map<string, Set<number>>()
  for (const chunk of state.output) {
    if (!sessionIds.has(chunk.sessionId)) {
      throw new Error(`Unknown terminal output session: ${chunk.sessionId}`)
    }

    const sessionSeqs = outputSeqBySession.get(chunk.sessionId) ?? new Set<number>()
    if (sessionSeqs.has(chunk.seq)) {
      throw new Error(`Duplicate terminal output seq: ${chunk.sessionId}#${chunk.seq}`)
    }
    sessionSeqs.add(chunk.seq)
    outputSeqBySession.set(chunk.sessionId, sessionSeqs)
  }
}

function collectWorkspacePanes(layout: TerminalWorkspace["layout"]): Array<{ paneId: string; sessionId: string }> {
  return layout.type === "leaf"
    ? [layout]
    : [...collectWorkspacePanes(layout.first), ...collectWorkspacePanes(layout.second)]
}

function collectWorkspaceSplitIds(layout: TerminalWorkspace["layout"]): string[] {
  return layout.type === "leaf"
    ? []
    : [layout.splitId, ...collectWorkspaceSplitIds(layout.first), ...collectWorkspaceSplitIds(layout.second)]
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
