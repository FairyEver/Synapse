/**
 * Phase 0.3 — Config IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/config-handlers.ts with IpcModule.
 */

import { z } from "zod"
import { app } from "electron"
import { readdir, rm, unlink } from "node:fs/promises"
import path from "node:path"
import type { IpcModule } from "../../runtime/ipc/types"
import type { SynapseCcConnectSettingsUpdate, SynapseConfigPatch } from "../../../src/types/config"
import { configBackupService } from "../../services/config-backup-service"
import { ccConnectSettingsService } from "../../services/cc-connect-settings-service"
import { previewLegacyCcConfigImport } from "../../services/legacy-cc-config-import"
import { configStore } from "../../services/config-store"
import { createMainLogger, logStore } from "../../services/log-store"
import { repositoryStore } from "../../services/repository-store"
import { shutdownDataStore } from "../../data-store"

const logger = createMainLogger("ipc.config")

// 重置应用时需要保留的文件前缀
const PRESERVED_FILE_PREFIXES = ["synapse-data.db"]

function shouldPreserveOnReset(entryName: string): boolean {
  return PRESERVED_FILE_PREFIXES.some((prefix) => entryName.startsWith(prefix))
}

// Schemas
const configSchema = z.object({
  activeRepoUuid: z.union([z.string(), z.null()]),
  repositories: z.array(z.any()),
  global: z.any(),
})

const configPatchSchema = z.any()

const exportResultSchema = z.object({
  success: z.boolean(),
  filePath: z.optional(z.string()),
  message: z.optional(z.string()),
})

const importResultSchema = z.object({
  success: z.boolean(),
  message: z.optional(z.string()),
})

const ccConnectLanguageSchema = z.enum(["en", "zh", "zh-TW", "ja", "es"])
const ccConnectAttachmentSendSchema = z.enum(["", "on", "off"])
const ccConnectLogLevelSchema = z.enum(["debug", "info", "warn", "error"])

const ccConnectSettingsSchema = z.object({
  language: ccConnectLanguageSchema,
  attachmentSend: ccConnectAttachmentSendSchema,
  logLevel: ccConnectLogLevelSchema,
  idleTimeoutMins: z.number(),
  thinkingMessages: z.boolean(),
  thinkingMaxLen: z.number(),
  toolMessages: z.boolean(),
  toolMaxLen: z.number(),
  streamPreviewEnabled: z.boolean(),
  streamPreviewIntervalMs: z.number(),
  rateLimitMaxMessages: z.number(),
  rateLimitWindowSecs: z.number(),
  lastReloadAt: z.string().nullable(),
  lastRestartRequestedAt: z.string().nullable(),
})

const ccConnectSettingsUpdateSchema = ccConnectSettingsSchema
  .omit({ lastReloadAt: true, lastRestartRequestedAt: true })
  .partial()

const ccConnectRawConfigSchema = z.object({
  format: z.literal("toml"),
  content: z.string(),
  redacted: z.boolean(),
  source: z.string(),
})

const ccConnectReloadResultSchema = z.object({
  message: z.string(),
  projectsUpdated: z.array(z.string()),
  reloadedAt: z.string(),
})

const ccConnectRestartRequestSchema = z.object({
  confirmed: z.boolean().optional(),
  sessionKey: z.string().optional(),
  platform: z.string().optional(),
}).optional()

const ccConnectRestartResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("confirmation_required"),
    message: z.string(),
  }),
  z.object({
    status: z.literal("recorded"),
    message: z.string(),
    requestedAt: z.string(),
    sessionKey: z.string(),
    platform: z.string(),
  }),
])

const ccConnectDiagnosticStatusSchema = z.enum(["pass", "warn", "fail"])

const ccConnectDiagnosticEndpointSchema = z.object({
  label: z.string(),
  value: z.string(),
})

const ccConnectDiagnosticsSchema = z.object({
  bridge: z.object({
    enabled: z.boolean(),
    endpoint: z.string(),
    tokenSet: z.boolean(),
    capabilities: z.array(z.string()),
    adapters: z.array(z.object({
      platform: z.string(),
      project: z.string(),
      capabilities: z.array(z.string()),
      connectedAt: z.string().nullable(),
    })),
  }),
  webhook: z.object({
    enabled: z.boolean(),
    endpoint: z.string(),
    tokenSet: z.boolean(),
    authMethods: z.array(z.string()),
    requestFields: z.array(z.string()),
    validation: z.array(z.string()),
  }),
  localApi: z.object({
    socketPath: z.string(),
    status: z.enum(["available", "missing", "blocked"]),
    permission: z.string(),
    endpoints: z.array(ccConnectDiagnosticEndpointSchema),
  }),
  managementApi: z.object({
    enabled: z.boolean(),
    endpoint: z.string(),
    tokenSet: z.boolean(),
    endpoints: z.array(ccConnectDiagnosticEndpointSchema),
  }),
  daemon: z.object({
    platform: z.string(),
    installed: z.boolean(),
    status: z.enum(["running", "stopped", "unknown"]),
    pid: z.number().nullable(),
    workDir: z.string(),
    logFile: z.string(),
    logMaxSizeMb: z.number(),
    guardedActions: z.array(z.string()),
  }),
  doctor: z.object({
    checks: z.array(z.object({
      name: z.string(),
      status: ccConnectDiagnosticStatusSchema,
      detail: z.string(),
    })),
    summary: z.record(ccConnectDiagnosticStatusSchema, z.number()),
  }),
  update: z.object({
    currentVersion: z.string(),
    installSource: z.string(),
    sources: z.array(z.string()),
    guardedActions: z.array(z.string()),
  }),
})

const legacyCcConfigImportPreviewSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  ignoredTopLevelKeys: z.array(z.string()),
  global: z.object({
    dataDir: z.string(),
    language: z.string().nullable(),
    attachmentSend: z.enum(["on", "off"]),
    logLevel: z.string(),
  }),
  projects: z.array(z.object({
    name: z.string(),
    mode: z.string().nullable(),
    workDir: z.string().nullable(),
    baseDir: z.string().nullable(),
    agentType: z.string().nullable(),
    providerRefs: z.array(z.string()),
    activeProvider: z.string().nullable(),
    platformTypes: z.array(z.string()),
    runAsUser: z.string().nullable(),
    runAsEnv: z.array(z.string()),
    issues: z.array(z.string()),
  })),
  providers: z.array(z.object({
    name: z.string(),
    source: z.enum(["global", "project"]),
    projectName: z.string().nullable(),
    baseUrl: z.string().nullable(),
    model: z.string().nullable(),
    agentTypes: z.array(z.string()),
    hasApiKey: z.boolean(),
  })),
})

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
      handler: async (_ctx, patch: SynapseConfigPatch) => {
        logger.info(`Handling config.update request. patch: ${JSON.stringify(patch)}`)
        const config = await configStore.update(patch)

        logger.info(
          `Config updated. activeRepoUuid: ${config.activeRepoUuid}, repositoryCount: ${config.repositories.length}`
        )

        return config
      },
    },
    exportBackup: {
      kind: "invoke",
      channel: "synapse:config:export-backup",
      request: z.void(),
      response: exportResultSchema,
      handler: async (_ctx) => {
        logger.info("Handling config.exportBackup request.")
        const result = await configBackupService.exportBackup()
        if (result === null) {
          return { success: false, message: "用户取消了导出操作。" }
        }
        return { success: true, filePath: result.filePath }
      },
    },
    importBackup: {
      kind: "invoke",
      channel: "synapse:config:import-backup",
      request: z.void(),
      response: importResultSchema,
      handler: async (_ctx) => {
        logger.info("Handling config.importBackup request.")
        const result = await configBackupService.importBackup()
        if (result === null) {
          return { success: false, message: "用户取消了导入操作。" }
        }
        return { success: true, message: "配置已成功导入。" }
      },
    },
    previewLegacyCcConfigImport: {
      kind: "invoke",
      channel: "synapse:config:preview-legacy-cc-config-import",
      request: z.object({ toml: z.string() }),
      response: legacyCcConfigImportPreviewSchema,
      handler: async (_ctx, payload: { toml: string }) => {
        logger.info("Handling config.previewLegacyCcConfigImport request.")
        return previewLegacyCcConfigImport(payload.toml, {
          homeDir: app.getPath("home"),
          platform: process.platform,
        })
      },
    },
    resetApp: {
      kind: "invoke",
      channel: "synapse:config:reset-app",
      request: z.void(),
      response: z.void(),
      handler: async (_ctx) => {
        logger.info("Handling config.resetApp request. Wiping all user data except data-store files.")

        repositoryStore.unwatchAll()
        await shutdownDataStore()
        await logStore.dispose()

        const userDataPath = app.getPath("userData")
        const entries = await readdir(userDataPath, { withFileTypes: true })

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
            // Best effort — some files may be locked by Chromium.
          }
        }

        app.relaunch()
        app.exit(0)
      },
    },
    getCcConnectSettings: {
      kind: "invoke",
      channel: "synapse:config:get-cc-connect-settings",
      request: z.void(),
      response: ccConnectSettingsSchema,
      handler: () => ccConnectSettingsService.getSettings(),
    },
    updateCcConnectSettings: {
      kind: "invoke",
      channel: "synapse:config:update-cc-connect-settings",
      request: ccConnectSettingsUpdateSchema,
      response: ccConnectSettingsSchema,
      handler: (_ctx, payload: SynapseCcConnectSettingsUpdate) => ccConnectSettingsService.updateSettings(payload),
    },
    getCcConnectRawConfig: {
      kind: "invoke",
      channel: "synapse:config:get-cc-connect-raw-config",
      request: z.void(),
      response: ccConnectRawConfigSchema,
      handler: () => ccConnectSettingsService.rawConfig(),
    },
    getCcConnectDiagnostics: {
      kind: "invoke",
      channel: "synapse:config:get-cc-connect-diagnostics",
      request: z.void(),
      response: ccConnectDiagnosticsSchema,
      handler: () => ccConnectSettingsService.diagnostics(),
    },
    reloadCcConnectConfig: {
      kind: "invoke",
      channel: "synapse:config:reload-cc-connect-config",
      request: z.void(),
      response: ccConnectReloadResultSchema,
      handler: () => ccConnectSettingsService.reload(),
    },
    restartCcConnect: {
      kind: "invoke",
      channel: "synapse:config:restart-cc-connect",
      request: ccConnectRestartRequestSchema,
      response: ccConnectRestartResultSchema,
      handler: (_ctx, payload) => ccConnectSettingsService.restart(payload ?? {}),
    },
  },
  events: {},
}
