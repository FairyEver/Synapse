/**
 * Phase 0.3 — Editor Scan IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/editor-scan-handlers.ts with IpcModule.
 */

import path from "node:path"
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type {
  EditorScanSkillRepositoryUploadRequest,
  EditorScanQuickPublishRequest,
  EditorScanTrashRequest,
} from "../../../src/types/editor-scan"
import {
  scanAll,
  readItemContent,
  listSkillFiles,
  assertTrustedEditorReadTarget,
  prepareQuickPublishDraft,
  trashScanItem,
} from "../../services/editor-scan-service"
import { skillRepositoryUploadService } from "../../services/skill-repository-upload-service"
import { resolveSkillMainFile } from "../../services/content-skill-source-service"

// Schemas
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
})

const quickPublishSkillFileSchema = z.object({
  originalName: z.string(),
  size: z.number(),
  bytes: z.instanceof(Uint8Array),
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
  }),
])

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

const uploadSkillToSkillRepositoryRequestSchema = z.object({
  itemType: z.enum(["skill", "rule", "prompt"]),
  itemPath: z.string().min(1),
  itemName: z.string().min(1),
  editorId: z.string().min(1),
  scope: z.enum(["global", "project"]),
  projectPath: z.string().nullable().optional(),
  mainFileName: z.string().nullable().optional(),
}).strict()
type UploadSkillToSkillRepositoryRequest = z.infer<typeof uploadSkillToSkillRepositoryRequestSchema>

const uploadSkillToSkillRepositoryResultSchema = z.object({
  repositoryId: z.string().min(1),
  name: z.string().min(1),
  owner: z.string().nullable(),
  managementUrl: z.string().url(),
  identityWritten: z.boolean(),
  identityWriteError: z.string().optional(),
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
      channel: "synapse:editor-scan:list-skill-files",
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
      channel: "synapse:editor-scan:prepare-quick-publish-draft",
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
    trashItem: {
      kind: "invoke",
      channel: "synapse:editor-scan:trash-item",
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
    uploadSkillToSkillRepository: {
      kind: "invoke",
      channel: "synapse:editor-scan:upload-skill-to-skill-repository",
      request: uploadSkillToSkillRepositoryRequestSchema,
      response: uploadSkillToSkillRepositoryResultSchema,
      handler: async (ctx, request: UploadSkillToSkillRepositoryRequest) => {
        if (request.itemType !== "skill") {
          throw new Error("只有 Skill 可以上传到 Skill Repository。")
        }
        const security = {
          actor: { kind: "user" } as const,
          auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        }
        await assertTrustedEditorReadTarget(security, request.itemPath, {
          contentType: request.itemType,
          itemName: request.itemName,
          operation: "upload-skill-to-skill-repository",
        }, "skill")
        const mainFile = await resolveSkillMainFile(request.itemPath)
        if (!mainFile || path.basename(mainFile) !== "SKILL.md") {
          throw new Error("上传到 Skill Repository 需要根目录 SKILL.md。")
        }
        return skillRepositoryUploadService.importLocal(
          {
            sourceDirectoryPath: (request as EditorScanSkillRepositoryUploadRequest).itemPath,
            name: (request as EditorScanSkillRepositoryUploadRequest).itemName,
            openInBrowser: false,
          },
          security,
        )
      },
    },
  },
  events: {},
}
