/**
 * Phase 0.3 — Editor IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/editor-handlers.ts with IpcModule.
 */

import { z } from "zod"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { shell } from "electron"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import { editorAdapterService } from "../../services/editor-adapter-service"
import { runGuardedShellOperation } from "../shell/guarded-shell"
import type { AuditSink, PermissionGuard } from "../../runtime/security"

type ResolvedGlobalEditorDirectoryCreation = {
  readonly directoryPath: string
  readonly metadata: Record<string, unknown>
}

async function resolveAllowedGlobalEditorDirectory(dirPath: string): Promise<ResolvedGlobalEditorDirectoryCreation> {
  const requestedPath = path.resolve(dirPath)
  const directories = await editorAdapterService.getGlobalDirectories()
  const allowedPaths = new Map<string, { readonly kind: "directory" | "file" }>()
  for (const entry of directories) {
    if (entry.rulesPath) {
      allowedPaths.set(path.resolve(entry.rulesPath), { kind: entry.rulesPathKind ?? "directory" })
    }
    if (entry.skillsPath) {
      allowedPaths.set(path.resolve(entry.skillsPath), { kind: entry.skillsPathKind ?? "directory" })
    }
  }

  const allowed = allowedPaths.get(requestedPath)
  if (!allowed) {
    throw new Error("只能创建已知编辑器目录。")
  }

  if (allowed.kind === "file") {
    return {
      directoryPath: path.dirname(requestedPath),
      metadata: {
        source: "editor.createDirectory",
        requestedPath,
        pathKind: "file",
      },
    }
  }

  return {
    directoryPath: requestedPath,
    metadata: { source: "editor.createDirectory" },
  }
}

async function createAndOpenDirectory(ctx: IpcHandlerContext, dirPath: string): Promise<void> {
  const target = await resolveAllowedGlobalEditorDirectory(dirPath)
  const actor = { kind: "user" } as const
  const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = ctx.resolve<AuditSink>("core.audit-sink")

  const permission = await permissionGuard.check({
    action: "fs.write",
    actor,
    resource: target.directoryPath,
    context: target.metadata,
  })
  if (!permission.allowed) {
    auditSink.record({
      action: "fs.write",
      actor,
      resource: target.directoryPath,
      outcome: "denied",
      metadata: {
        ...target.metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }

  try {
    await mkdir(target.directoryPath, { recursive: true })
    auditSink.record({
      action: "fs.write",
      actor,
      resource: target.directoryPath,
      outcome: "allowed",
      metadata: target.metadata,
    })
  } catch (error) {
    auditSink.record({
      action: "fs.write",
      actor,
      resource: target.directoryPath,
      outcome: "failed",
      metadata: {
        ...target.metadata,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      },
    })
    throw error
  }

  await runGuardedShellOperation({
    ctx,
    resource: target.directoryPath,
    source: "editor.createDirectory",
    run: () => shell.showItemInFolder(target.directoryPath),
  })
}

const globalDirectorySchema = z.object({
  editorId: z.string(),
  label: z.string(),
  rulesPath: z.string().nullable(),
  rulesPathKind: z.enum(["directory", "file"]).default("directory"),
  rulesExists: z.boolean(),
  skillsPath: z.string().nullable(),
  skillsPathKind: z.enum(["directory", "file"]).default("directory"),
  skillsExists: z.boolean(),
})

export const editorIpcModule: IpcModule = {
  id: "editor",
  methods: {
    getGlobalDirectories: {
      kind: "invoke",
      operationId: "app.editor.operation.get_global_directories",
      request: z.void(),
      response: z.array(globalDirectorySchema),
      handler: async (_ctx) => {
        return editorAdapterService.getGlobalDirectories()
      },
    },
    createDirectory: {
      kind: "invoke",
      operationId: "app.editor.operation.create_directory",
      request: z.object({ dirPath: z.string() }),
      response: z.void(),
      handler: async (ctx, request: { dirPath: string }) => {
        await createAndOpenDirectory(ctx, request.dirPath)
      },
    },
  },
  events: {},
}
