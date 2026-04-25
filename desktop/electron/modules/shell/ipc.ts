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
