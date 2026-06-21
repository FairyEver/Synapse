/**
 * Phase 0.3 — Config IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/config-handlers.ts with IpcModule.
 */

import { z } from "zod"
import { app, BrowserWindow } from "electron"
import { readdir, rm, unlink } from "node:fs/promises"
import path from "node:path"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { EventBus } from "../../runtime/event-bus"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../../runtime/security"
import type { SynapseConfigPatch, SynapseVariable } from "../../../src/types/config"
import { sanitizeConfigPatchForLog } from "../../../src/lib/config-log-redaction"
import { checkCapabilityPermission } from "../../capabilities/permission-audit"
import { configBackupService } from "../../services/config-backup-service"
import { configStore } from "../../services/config-store"
import { createMainLogger, logStore } from "../../services/log-store"
import { repositoryStore } from "../../services/repository-store"
import { shutdownDatabase } from "../../database"

const logger = createMainLogger("ipc.config")
let isConfigImportRunning = false

// 重置应用时需要保留的文件前缀
const PRESERVED_FILE_PREFIXES = ["synapse-database.db", "synapse-data.db"]

function shouldPreserveOnReset(entryName: string): boolean {
  return PRESERVED_FILE_PREFIXES.some((prefix) => entryName.startsWith(prefix))
}

function getParentWindow(): Electron.BrowserWindow | null {
  return BrowserWindow.getFocusedWindow()
    ?? BrowserWindow.getAllWindows().find((window) => window.isVisible() && !window.isDestroyed())
    ?? null
}

// Schemas
const permissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
])

const providerModelSchema = z.object({
  providerId: z.string(),
  modelTier: z.string(),
}).nullable()

const configSchema = z.object({
  activeRepoUuid: z.union([z.string(), z.null()]),
  repositories: z.array(z.any()),
  global: z.any(),
  agent: z.object({
    defaultPermissionMode: permissionModeSchema,
    defaultProviderModel: providerModelSchema,
  }),
})

const configPatchSchema = z.any()

const exportResultSchema = z.object({
  filePath: z.string(),
}).nullable()

const importResultSchema = z.object({
  filePath: z.string(),
}).nullable()

type VariableAuditPlan = {
  readonly name: string
  readonly change: "create" | "update" | "delete"
}

type VariableAuditEntry = {
  readonly resource: string
  readonly metadata: Record<string, unknown>
  readonly actor: ActorIdentity
}

export const configIpcModule: IpcModule = {
  id: "config",
  methods: {
    get: {
      kind: "invoke",
      channel: "synapse:config:get",
      request: z.void(),
      response: configSchema,
      handler: async (_ctx) => {
        logger.debug("Handling config.get request.")
        const config = await configStore.load()

        logger.debug(
          `Config loaded for renderer. activeRepoUuid: ${config.activeRepoUuid}, repositoryCount: ${config.repositories.length}`
        )

        return config
      },
    },
    update: {
      kind: "invoke",
      channel: "synapse:config:update",
      request: configPatchSchema,
      response: configSchema,
      handler: async (ctx, patch: SynapseConfigPatch) => {
        logger.info(`Handling config.update request. patch: ${JSON.stringify(sanitizeConfigPatchForLog(patch))}`)
        const variableAudits = await authorizeVariablePatch(ctx, patch)
        try {
          const config = await configStore.update(patch)
          if (patch.repositories !== undefined) {
            repositoryStore.reconcileRepositories(config.repositories)
          }

          recordVariableAudits(ctx, variableAudits, "allowed")
          emitVariablesUpdated(ctx, variableAudits)

          logger.info(
            `Config updated. activeRepoUuid: ${config.activeRepoUuid}, repositoryCount: ${config.repositories.length}`
          )

          return config
        } catch (error) {
          recordVariableAudits(ctx, variableAudits, "failed", {
            errorName: error instanceof Error ? error.name : typeof error,
            errorLength: String(error).length,
          })
          throw error
        }
      },
    },
    exportBackup: {
      kind: "invoke",
      channel: "synapse:config:export-backup",
      request: z.void(),
      response: exportResultSchema,
      handler: async (ctx) => {
        logger.info("Handling config.exportBackup request.")

        const filePath = await configBackupService.selectExportTarget({
          getParentWindow,
        })
        if (!filePath) {
          return null
        }

        const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
        const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
        const actor = { kind: "user" } as const
        const permission = await permissionGuard.check({
          action: "fs.write",
          actor,
          resource: filePath,
          context: { source: "config.exportBackup" },
        })
        if (!permission.allowed) {
          auditSink.record({
            action: "fs.write",
            actor,
            resource: filePath,
            outcome: "denied",
            metadata: {
              source: "config.exportBackup",
              reason: permission.reason,
              policyId: permission.policyId,
            },
          })
          throw new Error(permission.reason)
        }

        try {
          await configBackupService.writeExport(filePath)
          auditSink.record({
            action: "fs.write",
            actor,
            resource: filePath,
            outcome: "allowed",
            metadata: { source: "config.exportBackup" },
          })
          return { filePath }
        } catch (error) {
          auditSink.record({
            action: "fs.write",
            actor,
            resource: filePath,
            outcome: "failed",
            metadata: {
              source: "config.exportBackup",
              errorName: error instanceof Error ? error.name : typeof error,
              errorLength: String(error).length,
            },
          })
          throw error
        }
      },
    },
    importBackup: {
      kind: "invoke",
      channel: "synapse:config:import-backup",
      request: z.void(),
      response: importResultSchema,
      handler: async (ctx) => {
        logger.info("Handling config.importBackup request.")

        if (isConfigImportRunning) {
          throw new Error("已有配置导入正在进行，请稍后再试。")
        }
        isConfigImportRunning = true

        try {
          const filePath = await configBackupService.selectImportSource({
            getParentWindow,
          })
          if (!filePath) {
            return null
          }

          const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
          const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
          const actor = { kind: "user" } as const
          const permission = await permissionGuard.check({
            action: "fs.read.outside-userdata",
            actor,
            resource: filePath,
            context: { source: "config.importBackup" },
          })
          if (!permission.allowed) {
            auditSink.record({
              action: "fs.read.outside-userdata",
              actor,
              resource: filePath,
              outcome: "denied",
              metadata: {
                source: "config.importBackup",
                reason: permission.reason,
                policyId: permission.policyId,
              },
            })
            throw new Error(permission.reason)
          }

          auditSink.record({
            action: "fs.read.outside-userdata",
            actor,
            resource: filePath,
            outcome: "allowed",
            metadata: { source: "config.importBackup" },
          })

          let importPlan: Awaited<ReturnType<typeof configBackupService.prepareImport>>
          try {
            importPlan = await configBackupService.prepareImport(filePath)
          } catch (error) {
            auditSink.record({
              action: "fs.write",
              actor,
              resource: "config+identity",
              outcome: "failed",
              metadata: {
                operation: "config.import",
                source: "config.importBackup",
                errorName: error instanceof Error ? error.name : typeof error,
              },
            })
            throw error
          }

          const variableAudits = await authorizeVariableImport(ctx, importPlan.previousConfig.global.variables, importPlan.nextConfig.global.variables)

          try {
            const result = await configBackupService.commitImport(importPlan)
            recordVariableAudits(ctx, variableAudits, "allowed")
            auditSink.record({
              action: "fs.write",
              actor,
              resource: "config+identity",
              outcome: "allowed",
              metadata: { operation: "config.import", source: "config.importBackup" },
            })
            return result
          } catch (error) {
            auditSink.record({
              action: "fs.write",
              actor,
              resource: "config+identity",
              outcome: "failed",
              metadata: {
                operation: "config.import",
                source: "config.importBackup",
                errorName: error instanceof Error ? error.name : typeof error,
              },
            })
            recordVariableAudits(ctx, variableAudits, "failed", {
              errorName: error instanceof Error ? error.name : typeof error,
              errorLength: String(error).length,
            })
            throw error
          }
        } finally {
          isConfigImportRunning = false
        }
      },
    },
    resetApp: {
      kind: "invoke",
      channel: "synapse:config:reset-app",
      request: z.void(),
      response: z.union([z.object({ success: z.literal(true) }), z.object({ success: z.literal(false), failedCount: z.number(), failedEntries: z.array(z.string()) })]),
      handler: async (ctx) => {
        logger.info("Handling config.resetApp request. Wiping all user data except database files.")

        const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
        const actor = { kind: "user" } as const
        const userDataPath = app.getPath("userData")
        auditSink.record({
          action: "fs.write",
          actor,
          resource: "app:userData",
          outcome: "allowed",
          metadata: {
            operation: "app.reset",
            source: "config.resetApp",
            stage: "started",
          },
        })
        await flushAuditSink(auditSink)
        writeResetAppSystemLog("config.resetApp started", {
          operation: "app.reset",
          source: "config.resetApp",
        })

        repositoryStore.unwatchAll()
        await shutdownDatabase()
        await logStore.dispose()

        const entries = await readdir(userDataPath, { withFileTypes: true })

        const failedEntries: string[] = []

        for (const entry of entries) {
          if (shouldPreserveOnReset(entry.name)) {
            continue
          }

          const entryPath = path.join(userDataPath, entry.name)

          try {
            if (entry.isDirectory()) {
              await rm(entryPath, { recursive: true, force: true })
            } else {
              await unlink(entryPath)
            }
          } catch {
            failedEntries.push(entry.name)
            logger.warn("Failed to delete entry during app reset.", { entryName: entry.name })
            writeResetAppSystemLog("config.resetApp delete failed", {
              entryName: entry.name,
              operation: "app.reset",
              source: "config.resetApp",
            })
          }
        }

        if (failedEntries.length > 0) {
          logger.warn("App reset completed with some entries not deleted.", {
            failedCount: failedEntries.length,
            failedEntries,
          })
          await recordResetCompletionAudit(auditSink, "failed", { failedCount: failedEntries.length, failedEntries })
          writeResetAppSystemLog("config.resetApp completed with failures", {
            failedCount: failedEntries.length,
            operation: "app.reset",
            source: "config.resetApp",
          })
          app.relaunch()
          app.exit(0)
          return { success: false as const, failedCount: failedEntries.length, failedEntries }
        }

        await recordResetCompletionAudit(auditSink, "allowed", { failedCount: 0 })
        writeResetAppSystemLog("config.resetApp completed", {
          failedCount: 0,
          operation: "app.reset",
          source: "config.resetApp",
        })
        app.relaunch()
        app.exit(0)
        return { success: true as const }
      },
    },
  },
  events: {},
}

function extractVariablePatch(patch: SynapseConfigPatch): readonly SynapseVariable[] | null {
  if (!patch || typeof patch !== "object") {
    return null
  }
  const globalPatch = (patch as { global?: unknown }).global
  if (!globalPatch || typeof globalPatch !== "object") {
    return null
  }
  const variables = (globalPatch as { variables?: unknown }).variables
  if (!Array.isArray(variables)) {
    return null
  }
  if (!variables.every(isVariablePatchItem)) {
    return null
  }
  return variables
}

function isVariablePatchItem(value: unknown): value is SynapseVariable {
  if (!value || typeof value !== "object") {
    return false
  }
  const item = value as { name?: unknown; value?: unknown; description?: unknown }
  return typeof item.name === "string"
    && typeof item.value === "string"
    && (item.description === undefined || typeof item.description === "string")
}

async function authorizeVariablePatch(
  ctx: IpcHandlerContext,
  patch: SynapseConfigPatch,
): Promise<readonly VariableAuditEntry[]> {
  const nextVariables = extractVariablePatch(patch)
  if (!nextVariables) {
    return []
  }

  const previousConfig = await configStore.load()
  return authorizeVariableChanges(ctx, previousConfig.global.variables, nextVariables, {
    source: "settings",
    variableAction: "config.update.variables",
  })
}

async function authorizeVariableImport(
  ctx: IpcHandlerContext,
  previousVariables: readonly SynapseVariable[],
  nextVariables: readonly SynapseVariable[],
): Promise<readonly VariableAuditEntry[]> {
  return authorizeVariableChanges(ctx, previousVariables, nextVariables, {
    source: "config.importBackup",
    variableAction: "config.importBackup.variables",
  })
}

async function authorizeVariableChanges(
  ctx: IpcHandlerContext,
  previousVariables: readonly SynapseVariable[],
  nextVariables: readonly SynapseVariable[],
  metadataBase: { readonly source: string; readonly variableAction: string },
): Promise<readonly VariableAuditEntry[]> {
  const plans = buildVariableAuditPlans(previousVariables, nextVariables)
  if (plans.length === 0) {
    return []
  }

  const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
  const actor = { kind: "user" } as const
  const audits: VariableAuditEntry[] = []

  for (const plan of plans) {
    const resource = `variable:user:${plan.name}`
    const metadata = {
      source: metadataBase.source,
      variableAction: metadataBase.variableAction,
      variableName: plan.name,
      change: plan.change,
      includeValue: false,
    }
    const permission = await checkCapabilityPermission({
      permissionGuard,
      auditSink,
      action: "secret.write",
      actor,
      resource,
      context: metadata,
    })

    if (permission && !permission.allowed) {
      auditSink.record({
        action: "secret.write",
        actor,
        resource,
        outcome: "denied",
        metadata: {
          ...metadata,
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new Error(permission.reason)
    }

    audits.push({ actor, resource, metadata })
  }

  return audits
}

function buildVariableAuditPlans(
  previousVariables: readonly SynapseVariable[],
  nextVariables: readonly SynapseVariable[],
): readonly VariableAuditPlan[] {
  const previousByName = toVariableMap(previousVariables)
  const nextByName = toVariableMap(nextVariables)
  const plans: VariableAuditPlan[] = []

  for (const [normalizedName, previous] of previousByName) {
    if (!nextByName.has(normalizedName)) {
      plans.push({ name: previous.name, change: "delete" })
    }
  }

  for (const [normalizedName, next] of nextByName) {
    const previous = previousByName.get(normalizedName)
    if (!previous) {
      plans.push({ name: next.name, change: "create" })
      continue
    }
    if (hasVariableChanged(previous, next)) {
      plans.push({ name: next.name, change: "update" })
    }
  }

  return plans
}

function toVariableMap(variables: readonly SynapseVariable[]): Map<string, SynapseVariable> {
  return new Map(variables.map((variable) => [variable.name.toLowerCase(), variable]))
}

function hasVariableChanged(previous: SynapseVariable, next: SynapseVariable): boolean {
  return previous.name !== next.name
    || previous.value !== next.value
    || (previous.description ?? "") !== (next.description ?? "")
}

function recordVariableAudits(
  ctx: IpcHandlerContext,
  audits: readonly VariableAuditEntry[],
  outcome: "allowed" | "failed",
  metadata?: Record<string, unknown>,
): void {
  if (audits.length === 0) {
    return
  }
  const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
  for (const audit of audits) {
    auditSink.record({
      action: "secret.write",
      actor: audit.actor,
      resource: audit.resource,
      outcome,
      metadata: metadata ? { ...audit.metadata, ...metadata } : audit.metadata,
    })
  }
}

function emitVariablesUpdated(ctx: IpcHandlerContext, audits: readonly VariableAuditEntry[]): void {
  if (audits.length === 0) {
    return
  }
  const timestamp = new Date().toISOString()
  const eventBus = ctx.resolve<EventBus>("core.event-bus")
  eventBus.emit({
    domain: "repository",
    type: "repository.updated",
    payload: {
      operation: "variables",
      completedAt: timestamp,
      message: "变量已更新",
    },
    timestamp,
  })
}

async function flushAuditSink(auditSink: AuditSink): Promise<void> {
  const flush = (auditSink as { flush?: () => Promise<void> }).flush
  if (typeof flush === "function") {
    await flush.call(auditSink)
  }
}

async function recordResetCompletionAudit(
  auditSink: AuditSink,
  outcome: "allowed" | "failed",
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    auditSink.record({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "app:userData",
      outcome,
      metadata: {
        ...metadata,
        operation: "app.reset",
        source: "config.resetApp",
        stage: "completed",
      },
    })
    await flushAuditSink(auditSink)
  } catch (error) {
    writeResetAppSystemLog("config.resetApp completion audit failed", {
      errorName: error instanceof Error ? error.name : typeof error,
      operation: "app.reset",
      source: "config.resetApp",
    })
  }
}

function writeResetAppSystemLog(message: string, details: Record<string, unknown>): void {
  process.stderr.write(`[synapse-reset] ${message} ${JSON.stringify({
    timestamp: new Date().toISOString(),
    ...details,
  })}\n`)
}
