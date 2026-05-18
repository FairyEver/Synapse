/**
 * Phase 0.3 — Editor IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/editor-handlers.ts with IpcModule.
 */

import { z } from "zod"
import { mkdir } from "node:fs/promises"
import { shell } from "electron"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import { editorAdapterService } from "../../services/editor-adapter-service"
import { runGuardedShellOperation } from "../shell/guarded-shell"

async function createAndOpenDirectory(ctx: IpcHandlerContext, dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
  await runGuardedShellOperation({
    ctx,
    resource: dirPath,
    source: "editor.createDirectory",
    run: () => shell.showItemInFolder(dirPath),
  })
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
        return editorAdapterService.getGlobalDirectories()
      },
    },
    createDirectory: {
      kind: "invoke",
      channel: "synapse:editor:create-directory",
      request: z.object({ dirPath: z.string() }),
      response: z.void(),
      handler: async (ctx, request: { dirPath: string }) => {
        await createAndOpenDirectory(ctx, request.dirPath)
      },
    },
  },
  events: {},
}
