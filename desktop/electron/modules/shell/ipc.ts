/**
 * Phase 0.3 — Shell IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/shell-handlers.ts with IpcModule.
 */

import { z } from "zod"
import { shell } from "electron"
import type { IpcModule } from "../../runtime/ipc/types"
import { runGuardedShellOperation } from "./guarded-shell"
import { sanitizeUrl } from "../../../src/lib/url-sanitize"

export const shellIpcModule: IpcModule = {
  id: "shell",
  methods: {
    openExternal: {
      kind: "invoke",
      operationId: "app.shell.external.open",
      request: z.object({ url: z.string().url() }),
      response: z.void(),
      handler: async (ctx, request: { url: string }) => {
        const url = new URL(request.url)
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new Error("Only http and https links can be opened.")
        }
        const externalUrl = url.toString()
        const resource = sanitizeUrl(externalUrl)
        await runGuardedShellOperation({
          ctx,
          resource,
          source: "shell.openExternal",
          run: () => shell.openExternal(externalUrl),
        })
      },
    },
    showItemInFolder: {
      kind: "invoke",
      operationId: "app.shell.item.show_in_folder",
      request: z.object({ fullPath: z.string() }),
      response: z.void(),
      handler: async (ctx, request: { fullPath: string }) => {
        await runGuardedShellOperation({
          ctx,
          resource: request.fullPath,
          source: "shell.showItemInFolder",
          run: () => shell.showItemInFolder(request.fullPath),
        })
      },
    },
  },
  events: {},
}
