/**
 * Phase 0.3 — Editor Scan IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/editor-scan-handlers.ts with IpcModule.
 */

import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type {
  EditorScanFinalizeQuickPublishRequest,
  EditorScanQuickPublishRequest,
  EditorScanTrashRequest,
} from "../../../src/types/editor-scan"
import {
  scanAll,
  readItemContent,
  listSkillFiles,
  finalizeQuickPublish,
  prepareQuickPublishDraft,
  trashScanItem,
} from "../../services/editor-scan-service"

// Schemas
const editorScanRequestSchema = z.object({ requestId: z.string().uuid() }).strict()
const editorScanCancelResultSchema = z.object({ cancelled: z.boolean() })
const editorScanItemSourceSchema = z.enum(["synapse", "external"])

const editorScanTrashInfoSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("path") }),
  z.object({ mode: z.literal("rule-section"), ruleId: z.string() }),
  z.object({ mode: z.literal("unsupported"), disabledReason: z.string() }),
])

const editorScanSkillItemSchema = z.object({
  name: z.string(),
  path: z.string(),
  source: editorScanItemSourceSchema,
  synapseContentId: z.string().nullable(),
  repositoryVersion: z.string().nullable().optional(),
  preview: z.string(),
  mainFileName: z.string().nullable().optional(),
  fileCount: z.number(),
  trash: editorScanTrashInfoSchema,
})

const editorScanRuleItemSchema = z.object({
  name: z.string(),
  path: z.string(),
  source: editorScanItemSourceSchema,
  synapseContentId: z.string().nullable(),
  preview: z.string(),
  metadata: z.record(z.string(), z.string()),
  content: z.string().optional(),
  trash: editorScanTrashInfoSchema,
})

const editorScanEditorResultSchema = z.object({
  editorId: z.string(),
  editorLabel: z.string(),
  skills: z.array(editorScanSkillItemSchema),
  skillScanError: z.string().optional(),
  rules: z.array(editorScanRuleItemSchema),
})

const editorScanGlobalResultSchema = editorScanEditorResultSchema.extend({
  status: z.enum(["detected", "not-detected"]),
  duplicateSkillNames: z.array(z.string()),
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

const quickPublishRequestSchema = z.object({
  itemType: z.enum(["skill", "rule"]),
  itemPath: z.string(),
  itemName: z.string(),
  ruleContent: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  purpose: z.enum(["copy", "publish"]).optional(),
  synapseContentId: z.string().optional(),
})

const quickPublishSkillFileSchema = z.object({
  originalName: z.string(),
  size: z.number(),
  bytes: z.instanceof(Uint8Array),
})

const sourceImportSummarySchema = z.object({
  controlFilesExcluded: z.array(z.string()),
  fileCount: z.number().int().nonnegative(),
  hiddenEntryCount: z.number().int().nonnegative(),
  runtimeEnvExcluded: z.boolean(),
  symlinkCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
})

const quickPublishDraftSchema = z.discriminatedUnion("itemType", [
  z.object({
    itemType: z.literal("rule"),
    itemPath: z.string(),
    itemName: z.string(),
    content: z.string(),
    metadata: z.record(z.string(), z.string()),
  }),
  z.object({
    itemType: z.literal("skill"),
    itemPath: z.string(),
    itemName: z.string(),
    content: z.string(),
    files: z.array(quickPublishSkillFileSchema),
    metadata: z.record(z.string(), z.string()),
    publishFingerprint: z.string().min(1),
    publishSessionId: z.string().uuid().optional(),
    sourceFingerprint: z.string().min(1),
    sourceImportSummary: sourceImportSummarySchema,
  }),
])

const finalizeQuickPublishRequestSchema = z.object({
  contentId: z.string().min(1),
  mode: z.enum(["new", "overwrite"]),
  repositoryVersion: z.string().min(1),
  sessionId: z.string().uuid(),
}).strict()

const finalizeQuickPublishResultSchema = z.object({
  message: z.string().min(1),
  status: z.enum([
    "content-mismatch",
    "identity-conflict",
    "identity-written",
    "session-expired",
    "source-changed",
    "write-failed",
  ]),
})

const trashRequestSchema = z.object({
  itemType: z.literal("rule"),
  itemName: z.string(),
  itemPath: z.string(),
  editorId: z.string(),
  scope: z.enum(["global", "project"]),
  source: editorScanItemSourceSchema,
  trash: editorScanTrashInfoSchema,
  synapseContentId: z.string().nullable().optional(),
})

const trashResultSchema = z.object({
  trashed: z.literal(true),
  mode: z.enum(["path", "rule-section", "unsupported"]),
  path: z.string(),
})

const activeScanControllers = new Map<string, AbortController>()

export const editorScanIpcModule: IpcModule = {
  id: "editor-scan",
  methods: {
    scanAll: {
      kind: "invoke",
      operationId: "app.editor_scan.operation.scan_all",
      request: editorScanRequestSchema,
      response: editorScanResultSchema,
      handler: async (_ctx, request: { requestId: string }) => {
        const controller = new AbortController()
        activeScanControllers.get(request.requestId)?.abort()
        activeScanControllers.set(request.requestId, controller)
        try {
          return await scanAll(controller.signal)
        } finally {
          if (activeScanControllers.get(request.requestId) === controller) {
            activeScanControllers.delete(request.requestId)
          }
        }
      },
    },
    cancelScan: {
      kind: "invoke",
      operationId: "app.editor_scan.operation.cancel_scan",
      request: editorScanRequestSchema,
      response: editorScanCancelResultSchema,
      handler: async (_ctx, request: { requestId: string }) => {
        const controller = activeScanControllers.get(request.requestId)
        if (!controller) return { cancelled: false }
        controller.abort()
        return { cancelled: true }
      },
    },
    readItemContent: {
      kind: "invoke",
      operationId: "app.editor_scan.operation.read_item_content",
      request: z.object({ filePath: z.string() }),
      response: z.string(),
      handler: async (ctx, request: { filePath: string }) => {
        return readItemContent(request.filePath, {
          actor: { kind: "user" },
          auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        })
      },
    },
    listSkillFiles: {
      kind: "invoke",
      operationId: "app.editor_scan.operation.list_skill_files",
      request: z.object({ dirPath: z.string() }),
      response: z.array(skillFileInfoSchema),
      handler: async (ctx, request: { dirPath: string }) => {
        return listSkillFiles(request.dirPath, {
          actor: { kind: "user" },
          auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        })
      },
    },
    prepareQuickPublishDraft: {
      kind: "invoke",
      operationId: "app.editor_scan.operation.prepare_quick_publish_draft",
      request: quickPublishRequestSchema,
      response: quickPublishDraftSchema,
      handler: async (ctx, request: EditorScanQuickPublishRequest) => {
        return prepareQuickPublishDraft(request, {
          actor: { kind: "user" },
          auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        })
      },
    },
    finalizeQuickPublish: {
      kind: "invoke",
      operationId: "app.editor_scan.operation.finalize_quick_publish",
      request: finalizeQuickPublishRequestSchema,
      response: finalizeQuickPublishResultSchema,
      handler: async (ctx, request: EditorScanFinalizeQuickPublishRequest) => {
        return finalizeQuickPublish(request, {
          actor: { kind: "user" },
          auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        })
      },
    },
    trashItem: {
      kind: "invoke",
      operationId: "app.editor_scan.operation.trash_item",
      request: trashRequestSchema,
      response: trashResultSchema,
      handler: async (ctx, request: EditorScanTrashRequest) => {
        return trashScanItem(request, {
          actor: { kind: "user" },
          auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        })
      },
    },
  },
  events: {},
}
