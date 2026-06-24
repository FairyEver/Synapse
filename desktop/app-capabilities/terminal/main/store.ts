import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import {
  terminalGroupSchema,
  terminalOutputChunkSchema,
  terminalSessionSchema,
  type TerminalGroup,
  type TerminalOutputChunk,
  type TerminalSession,
} from "../shared/schema"

export const terminalStoreStateSchema = z.object({
  groups: z.array(terminalGroupSchema),
  sessions: z.array(terminalSessionSchema),
  output: z.array(terminalOutputChunkSchema),
})

export type TerminalStoreState = z.infer<typeof terminalStoreStateSchema>

export type TerminalStore = {
  loadState(): Promise<TerminalStoreState>
  saveState(state: {
    groups: TerminalGroup[]
    sessions: TerminalSession[]
    output: TerminalOutputChunk[]
  }): Promise<void>
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
          return { groups: [], sessions: [], output: [] }
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
  for (const session of state.sessions) {
    if (sessionIds.has(session.id)) {
      throw new Error(`Duplicate terminal session id: ${session.id}`)
    }
    if (!groupIds.has(session.groupId)) {
      throw new Error(`Unknown terminal session group: ${session.groupId}`)
    }
    sessionIds.add(session.id)
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
