/**
 * Phase 0.3 — Editor IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/editor-handlers.ts with IpcModule.
 */

import { z } from "zod"
import { access, mkdir } from "node:fs/promises"
import { shell } from "electron"
import type { IpcModule } from "../../runtime/ipc/types"
import { editorAdapters } from "../../services/editor-adapters"

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function getGlobalDirectories() {
  const entries = editorAdapters.map((adapter) => {
    const paths = adapter.resolveGlobalDirectoryPaths()
    return { adapter, paths }
  })

  const checks = entries.flatMap(({ paths }) => [
    paths.rulesPath ? pathExists(paths.rulesPath) : Promise.resolve(false),
    paths.skillsPath ? pathExists(paths.skillsPath) : Promise.resolve(false),
  ])

  const results = await Promise.all(checks)

  return entries.map(({ adapter, paths }, index) => ({
    editorId: adapter.id,
    label: adapter.label,
    rulesPath: paths.rulesPath,
    rulesExists: results[index * 2],
    skillsPath: paths.skillsPath,
    skillsExists: results[index * 2 + 1],
  }))
}

async function createAndOpenDirectory(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
  shell.showItemInFolder(dirPath)
}

const globalDirectorySchema = z.object({
  editorId: z.string(),
  label: z.string(),
  rulesPath: z.string().nullable(),
  rulesExists: z.boolean(),
  skillsPath: z.string().nullable(),
  skillsExists: z.boolean(),
})

export const editorIpcModule: IpcModule = {
  id: "editor",
  methods: {
    getGlobalDirectories: {
      kind: "invoke",
      channel: "synapse:editor:get-global-directories",
      request: z.void(),
      response: z.array(globalDirectorySchema),
      handler: async (_ctx) => {
        return getGlobalDirectories()
      },
    },
    createDirectory: {
      kind: "invoke",
      channel: "synapse:editor:create-directory",
      request: z.object({ dirPath: z.string() }),
      response: z.void(),
      handler: async (_ctx, request: { dirPath: string }) => {
        await createAndOpenDirectory(request.dirPath)
      },
    },
  },
  events: {},
}
