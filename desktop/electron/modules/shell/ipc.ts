/**
 * Phase 0.3 — Shell IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/shell-handlers.ts with IpcModule.
 */

import { z } from "zod"
import { shell } from "electron"
import type { IpcModule } from "../../runtime/ipc/types"

export const shellIpcModule: IpcModule = {
  id: "shell",
  methods: {
    openExternal: {
      kind: "invoke",
      channel: "synapse:shell:open-external",
      request: z.object({ url: z.string().url() }),
      response: z.void(),
      handler: async (_ctx, request: { url: string }) => {
        const url = new URL(request.url)
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new Error("Only http and https links can be opened.")
        }
        await shell.openExternal(url.toString())
      },
    },
    showItemInFolder: {
      kind: "invoke",
      channel: "synapse:shell:show-item-in-folder",
      request: z.object({ fullPath: z.string() }),
      response: z.void(),
      handler: async (_ctx, request: { fullPath: string }) => {
        shell.showItemInFolder(request.fullPath)
      },
    },
  },
  events: {},
}
