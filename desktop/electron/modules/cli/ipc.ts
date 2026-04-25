/**
 * Phase 0.3 — CLI IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/cli-handlers.ts with IpcModule.
 */

import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import { detectClis } from "../../services/cli/cli-detect-service"

// Schema for CLI detection result
const cliInfoSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  path: z.string().optional(),
})

export const cliIpcModule: IpcModule = {
  id: "cli",
  methods: {
    detect: {
      kind: "invoke",
      channel: "synapse:cli:detect",
      request: z.void(),
      response: z.array(cliInfoSchema),
      handler: async (_ctx) => {
        return detectClis()
      },
    },
  },
  events: {},
}
