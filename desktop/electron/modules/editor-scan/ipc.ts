/**
 * Phase 0.3 — Editor Scan IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/editor-scan-handlers.ts with IpcModule.
 */

import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import { scanAll, readItemContent, listSkillFiles } from "../../services/editor-scan-service"

// Schemas
const editorScanResultSchema = z.object({
  editors: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      version: z.string().optional(),
      path: z.string(),
    })
  ),
})

const skillFileInfoSchema = z.object({
  name: z.string(),
  path: z.string(),
})

export const editorScanIpcModule: IpcModule = {
  id: "editor-scan",
  methods: {
    scanAll: {
      kind: "invoke",
      channel: "synapse:editor-scan:scan-all",
      request: z.void(),
      response: editorScanResultSchema,
      handler: async (_ctx) => {
        return scanAll()
      },
    },
    readItemContent: {
      kind: "invoke",
      channel: "synapse:editor-scan:read-item-content",
      request: z.object({ filePath: z.string() }),
      response: z.object({ content: z.string() }),
      handler: async (_ctx, request: { filePath: string }) => {
        return readItemContent(request.filePath)
      },
    },
    listSkillFiles: {
      kind: "invoke",
      channel: "synapse:editor-scan:list-skill-files",
      request: z.object({ dirPath: z.string() }),
      response: z.array(skillFileInfoSchema),
      handler: async (_ctx, request: { dirPath: string }) => {
        return listSkillFiles(request.dirPath)
      },
    },
  },
  events: {},
}
