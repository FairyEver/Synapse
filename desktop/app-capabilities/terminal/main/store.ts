import { mkdir, readFile, writeFile } from "node:fs/promises"
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
        return terminalStoreStateSchema.parse(JSON.parse(raw))
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          return { groups: [], sessions: [], output: [] }
        }
        throw error
      }
    },
    async saveState(state) {
      const parsed = terminalStoreStateSchema.parse(state)
      await mkdir(options.baseDir, { recursive: true })
      await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
    },
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
