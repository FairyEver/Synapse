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
const editorScanItemSourceSchema = z.enum(["synapse", "external"])

const editorScanSkillItemSchema = z.object({
  name: z.string(),
  path: z.string(),
  source: editorScanItemSourceSchema,
  synapseContentId: z.string().nullable(),
  preview: z.string(),
  fileCount: z.number(),
})

const editorScanRuleItemSchema = z.object({
  name: z.string(),
  path: z.string(),
  source: editorScanItemSourceSchema,
  synapseContentId: z.string().nullable(),
  preview: z.string(),
  metadata: z.record(z.string(), z.string()),
})

const editorScanEditorResultSchema = z.object({
  editorId: z.string(),
  editorLabel: z.string(),
  skills: z.array(editorScanSkillItemSchema),
  rules: z.array(editorScanRuleItemSchema),
})

const editorScanGlobalResultSchema = editorScanEditorResultSchema.extend({
  status: z.enum(["detected", "not-detected"]),
  rulesSupported: z.boolean(),
})

const editorScanProjectResultSchema = z.object({
  projectPath: z.string(),
  projectName: z.string(),
  pathExists: z.boolean(),
  editors: z.array(editorScanEditorResultSchema),
})

const editorScanResultSchema = z.object({
  global: z.array(editorScanGlobalResultSchema),
  projects: z.array(editorScanProjectResultSchema),
})

const skillFileInfoSchema = z.object({
  name: z.string(),
  size: z.number(),
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
      response: z.string(),
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
