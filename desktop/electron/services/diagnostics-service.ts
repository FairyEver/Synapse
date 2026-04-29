import { copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { SynapseConfig } from "../../src/types/config"
import type {
  SynapseDiagnosticsBundleExportResult,
  SynapseDiagnosticsCheck,
  SynapseDiagnosticsReport,
} from "../../src/types/diagnostics"
import type {
  DataStoreMcpHttpStatus,
  DataStoreMcpServerInfo,
  DataStoreStatus,
} from "../../src/types/data-store"
import type { SynapseOpsDiagnostics } from "../../src/types/bridge"
import type { DataRepository } from "../runtime/data-repo"
import type { StructuredLogger } from "../runtime/logging"
import type { ServiceRegistry } from "../runtime/service-registry"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import type { ServiceResolver } from "../modules/ops/status"

type AppPathName = Parameters<Electron.App["getPath"]>[0]

type AppInfo = {
  getAppPath(): string
  getLocale(): string
  getName(): string
  getVersion(): string
  hasSingleInstanceLock(): boolean
  readonly isPackaged: boolean
  getPath(name: AppPathName): string
}

type PlatformInfo = Record<string, unknown> & {
  platform: string
  arch: string
  release: string
  node: string
  pid: number
}

type PathStats = {
  isDirectory(): boolean
}

type ConfigStoreLike = {
  load(): Promise<SynapseConfig>
}

type LogStoreLike = {
  flush(): Promise<void>
  getLogDirectory(): string
  listLogFilesInfo(): Promise<Array<{ name: string; sizeBytes: number }>>
}

type DataStoreLike = {
  exportDatabase(targetPath: string): void
  getDbPath(): string
  getDbSize(): number
  getTableCount(): number
}

type MaybePromise<T> = T | Promise<T>

type CliDebugInfo = Record<string, unknown> & {
  status?: {
    available?: boolean
  }
}

type DiagnosticsServiceDeps = {
  appInfo: AppInfo
  configStore: ConfigStoreLike
  dataRepository: Pick<DataRepository, "inspect">
  serviceRegistry: Pick<ServiceRegistry, "get" | "inspect">
  logStore: LogStoreLike
  dataStore: DataStoreLike
  getDataStoreRuntimeStatus: () => DataStoreStatus
  collectOpsStatus: (
    resolve: ServiceResolver,
    request?: { projectId?: string },
  ) => Promise<SynapseOpsDiagnostics>
  getCliDebugInfo: () => Promise<CliDebugInfo>
  getMcpHttpStatus: () => DataStoreMcpHttpStatus
  getMcpServers: () => MaybePromise<DataStoreMcpServerInfo[]>
  permissionGuard: PermissionGuard
  auditSink: AuditSink
  logger: StructuredLogger
  now?: () => Date
  platformInfo?: () => PlatformInfo
  statPath?: (targetPath: string) => Promise<PathStats>
  writeReadDeleteProbe?: (directoryPath: string) => Promise<void>
  chooseSavePath?: (defaultFileName: string) => Promise<string | null>
  makeTempDir?: (prefix: string) => Promise<string>
  writeTextFile?: (targetPath: string, content: string) => Promise<void>
  copyFile?: (sourcePath: string, targetPath: string) => Promise<void>
  createZipArchive?: (sourceDirectoryPath: string, outputFilePath: string) => Promise<void>
  removePath?: (targetPath: string) => Promise<void>
  createConfigBackupPayload?: () => Promise<unknown>
}

type DiagnosticsSummary = Pick<SynapseDiagnosticsReport, "overallStatus" | "summary">

function summarizeDiagnosticsChecks(checks: SynapseDiagnosticsCheck[]): DiagnosticsSummary {
  const summary = {
    ok: 0,
    degraded: 0,
    failed: 0,
    skipped: 0,
  }

  for (const check of checks) {
    summary[check.status] += 1
  }

  return {
    overallStatus: summary.failed > 0 ? "failed" : summary.degraded > 0 ? "degraded" : "ok",
    summary,
  }
}

class DiagnosticsService {
  private readonly deps: DiagnosticsServiceDeps
  private lastExportedAt: string | undefined
  private lastExportPath: string | undefined

  constructor(deps: DiagnosticsServiceDeps) {
    this.deps = deps
  }

  async collect(payload: { projectId?: string } = {}): Promise<SynapseDiagnosticsReport> {
    const generatedAt = this.now().toISOString()
    const checks: SynapseDiagnosticsCheck[] = []
    const config = await this.loadConfig(checks)
    const activeProject = resolveActiveProject(config, payload.projectId)
    const activeRepository = config.repositories.find((item) => item.uuid === config.activeRepoUuid)

    checks.push(this.ok("system.process", "系统", "进程", "系统信息已读取", this.platformInfo()))
    checks.push(this.ok("app.version", "应用", "版本", this.deps.appInfo.getVersion(), {
      appName: this.deps.appInfo.getName(),
      appPath: this.deps.appInfo.getAppPath(),
      locale: this.deps.appInfo.getLocale(),
      isPackaged: this.deps.appInfo.isPackaged,
      singleInstanceLocked: this.deps.appInfo.hasSingleInstanceLock(),
    }))

    await this.addPathChecks(checks, config)
    await this.addLogChecks(checks)
    await this.addDataStoreChecks(checks)
    await this.addInspectChecks(checks)
    await this.addOpsChecks(checks, payload.projectId)

    const { overallStatus, summary } = summarizeDiagnosticsChecks(checks)

    return {
      schemaVersion: 1,
      generatedAt,
      overallStatus,
      summary,
      system: this.platformInfo(),
      app: {
        name: this.deps.appInfo.getName(),
        version: this.deps.appInfo.getVersion(),
        locale: this.deps.appInfo.getLocale(),
        isPackaged: this.deps.appInfo.isPackaged,
        singleInstanceLocked: this.deps.appInfo.hasSingleInstanceLock(),
        appPath: this.deps.appInfo.getAppPath(),
        userDataPath: this.deps.appInfo.getPath("userData"),
        tempPath: this.deps.appInfo.getPath("temp"),
        downloadsPath: this.deps.appInfo.getPath("downloads"),
        logPath: this.deps.logStore.getLogDirectory(),
      },
      activeContext: {
        repositoryUuid: activeRepository?.uuid,
        repositoryName: activeRepository?.name,
        projectId: activeProject?.id,
        projectName: activeProject?.name,
      },
      checks,
      bundle: {
        lastExportedAt: this.lastExportedAt,
        lastExportPath: this.lastExportPath,
      },
    }
  }

  async exportBundle(payload: { report: SynapseDiagnosticsReport }): Promise<SynapseDiagnosticsBundleExportResult> {
    const folderName = createDiagnosticsFolderName(payload.report.generatedAt)
    const defaultFileName = `${folderName}.zip`
    const outputPath = await this.chooseSavePath(defaultFileName)
    if (!outputPath) return { success: false }

    const permission = await this.deps.permissionGuard.check({
      action: "fs.write",
      actor: { kind: "user" },
      resource: outputPath,
      context: { source: "ops.exportDiagnosticsBundle" },
    })
    if (!permission.allowed) {
      this.deps.auditSink.record({
        action: "fs.write",
        actor: { kind: "user" },
        resource: outputPath,
        outcome: "denied",
        metadata: {
          source: "ops.exportDiagnosticsBundle",
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new Error(permission.reason)
    }

    const stagingRoot = await this.makeTempDir("synapse-diagnostics-")
    const packageRoot = path.join(stagingRoot, folderName)
    const included: string[] = []
    const skipped: Array<{ path: string; reason: string }> = []
    const exportedAt = this.now().toISOString()

    try {
      await mkdir(path.join(packageRoot, "logs"), { recursive: true })
      await mkdir(path.join(packageRoot, "config"), { recursive: true })
      await mkdir(path.join(packageRoot, "data-store"), { recursive: true })

      const report = {
        ...payload.report,
        bundle: {
          lastExportedAt: exportedAt,
          lastExportPath: outputPath,
        },
      }

      await this.writeTextFile(
        path.join(packageRoot, "diagnostics.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      )
      included.push("diagnostics.json")

      await this.writeOptionalJsonFile(
        path.join(packageRoot, "config", "config-backup.json"),
        "config/config-backup.json",
        () => this.createConfigBackupPayload(),
        included,
        skipped,
      )

      const databaseTargetPath = path.join(packageRoot, "data-store", "synapse-data.db")
      await this.copyOptionalFile(
        this.deps.dataStore.getDbPath(),
        databaseTargetPath,
        "data-store/synapse-data.db",
        included,
        skipped,
        () => this.deps.dataStore.exportDatabase(databaseTargetPath),
      )

      await this.copyLogFiles(packageRoot, included, skipped)

      const manifest = {
        schemaVersion: 1,
        generatedAt: exportedAt,
        appVersion: this.deps.appInfo.getVersion(),
        reportStatus: payload.report.overallStatus,
        included,
        skipped,
      }
      await this.writeTextFile(
        path.join(packageRoot, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      )
      included.push("manifest.json")

      await this.createZipArchive(packageRoot, outputPath)
      this.lastExportedAt = exportedAt
      this.lastExportPath = outputPath
      this.deps.auditSink.record({
        action: "fs.write",
        actor: { kind: "user" },
        resource: outputPath,
        outcome: "allowed",
        metadata: { source: "ops.exportDiagnosticsBundle", includedCount: included.length },
      })
      return { success: true, filePath: outputPath, fileCount: included.length }
    } catch (error) {
      this.deps.auditSink.record({
        action: "fs.write",
        actor: { kind: "user" },
        resource: outputPath,
        outcome: "failed",
        metadata: {
          source: "ops.exportDiagnosticsBundle",
          error: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    } finally {
      await this.removePath(stagingRoot).catch((error: unknown) => {
        this.deps.logger.warn("Diagnostics staging cleanup failed.", {
          error: error instanceof Error ? error.message : String(error),
          stagingRoot,
        })
      })
    }
  }

  private async loadConfig(checks: SynapseDiagnosticsCheck[]): Promise<SynapseConfig> {
    try {
      const config = await this.deps.configStore.load()
      checks.push(this.ok("config.load", "日志与配置", "配置", "配置已读取", {
        repositoryCount: config.repositories.length,
        projectCount: config.global.projects.length,
        activeRepoUuid: config.activeRepoUuid,
      }))
      return config
    } catch (error) {
      checks.push({
        id: "config.load",
        group: "日志与配置",
        name: "配置",
        status: "failed",
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
      })
      return createEmptyConfig()
    }
  }

  private async addPathChecks(
    checks: SynapseDiagnosticsCheck[],
    config: SynapseConfig,
  ): Promise<void> {
    const tempPath = this.deps.appInfo.getPath("temp")
    await this.capture(checks, "path.temp.write", "路径与权限", "临时目录写入", async () => {
      await this.writeReadDeleteProbe(tempPath)
      return this.ok("path.temp.write", "路径与权限", "临时目录写入", "通过", { path: tempPath })
    })

    for (const repository of config.repositories) {
      await this.capture(checks, `repository.path.${repository.uuid}`, "路径与权限", repository.name, async () => {
        const pathStats = await this.statPath(repository.localPath)
        return pathStats.isDirectory()
          ? this.ok(`repository.path.${repository.uuid}`, "路径与权限", repository.name, "目录可访问", { path: repository.localPath })
          : this.degraded(`repository.path.${repository.uuid}`, "路径与权限", repository.name, "路径不是目录", { path: repository.localPath })
      })
    }

    for (const project of config.global.projects) {
      await this.capture(checks, `project.path.${project.id}`, "路径与权限", project.name, async () => {
        const pathStats = await this.statPath(project.path)
        return pathStats.isDirectory()
          ? this.ok(`project.path.${project.id}`, "路径与权限", project.name, "目录可访问", { path: project.path })
          : this.degraded(`project.path.${project.id}`, "路径与权限", project.name, "路径不是目录", { path: project.path })
      })
    }
  }

  private async addLogChecks(checks: SynapseDiagnosticsCheck[]): Promise<void> {
    await this.capture(checks, "logs.files", "日志与配置", "日志文件", async () => {
      const files = await this.deps.logStore.listLogFilesInfo()
      return this.ok("logs.files", "日志与配置", "日志文件", "日志信息已读取", {
        count: files.length,
        totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
        logPath: this.deps.logStore.getLogDirectory(),
      })
    })
  }

  private async addDataStoreChecks(checks: SynapseDiagnosticsCheck[]): Promise<void> {
    await this.capture(checks, "data-store.status", "Data Store", "数据库", async () => {
      const runtimeStatus = this.deps.getDataStoreRuntimeStatus()
      const details = {
        ...runtimeStatus,
        dbPath: this.deps.dataStore.getDbPath(),
        dbSize: this.deps.dataStore.getDbSize(),
        tableCount: this.deps.dataStore.getTableCount(),
      }
      return runtimeStatus.running
        ? this.ok("data-store.status", "Data Store", "数据库", "数据库状态已读取", details)
        : this.degraded("data-store.status", "Data Store", "数据库", "数据库未运行", details)
    })

    await this.capture(checks, "data-store.cli", "Data Store", "CLI", async () => {
      const debugInfo = await this.deps.getCliDebugInfo()
      const available = debugInfo.status?.available === true
      return available
        ? this.ok("data-store.cli", "Data Store", "CLI", "CLI 可用", debugInfo)
        : this.degraded("data-store.cli", "Data Store", "CLI", "CLI 不可用", debugInfo)
    })

    await this.capture(checks, "data-store.mcp", "Data Store", "MCP", async () => {
      const http = this.deps.getMcpHttpStatus()
      const registrations = await Promise.resolve(this.deps.getMcpServers())
      return this.ok("data-store.mcp", "Data Store", "MCP", "MCP 状态已读取", {
        http,
        registrations,
      })
    })
  }

  private async addInspectChecks(checks: SynapseDiagnosticsCheck[]): Promise<void> {
    await this.capture(checks, "services.inspect", "服务", "服务注册表", async () => {
      const services = this.deps.serviceRegistry.inspect()
      const failed = services.filter((service) => service.status === "failed")
      if (failed.some((service) => service.criticality === "fatal")) {
        return this.failed("services.inspect", "服务", "服务注册表", "存在失败的关键服务", { services })
      }
      if (failed.length > 0) {
        return this.degraded("services.inspect", "服务", "服务注册表", "存在降级服务", { services })
      }
      return this.ok("services.inspect", "服务", "服务注册表", "服务信息已读取", { services })
    })

    await this.capture(checks, "data-repo.inspect", "服务", "DataRepository", async () =>
      this.ok("data-repo.inspect", "服务", "DataRepository", "数据仓库信息已读取", {
        namespaces: this.deps.dataRepository.inspect(),
      }))
  }

  private async addOpsChecks(checks: SynapseDiagnosticsCheck[], projectId?: string): Promise<void> {
    await this.capture(checks, "ops.status", "连接器", "运行状态", async () => {
      const status = await this.deps.collectOpsStatus(
        (serviceId) => this.deps.serviceRegistry.get(serviceId),
        projectId ? { projectId } : undefined,
      )
      return this.ok("ops.status", "连接器", "运行状态", "运行状态已读取", status)
    })
  }

  private async capture(
    checks: SynapseDiagnosticsCheck[],
    id: string,
    group: string,
    name: string,
    run: () => Promise<SynapseDiagnosticsCheck>,
  ): Promise<void> {
    const startedAt = Date.now()
    try {
      const check = await run()
      checks.push({ ...check, durationMs: Date.now() - startedAt })
    } catch (error) {
      checks.push({
        id,
        group,
        name,
        status: "failed",
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      })
    }
  }

  private async writeOptionalJsonFile(
    targetPath: string,
    relativePath: string,
    getValue: () => unknown | Promise<unknown>,
    included: string[],
    skipped: Array<{ path: string; reason: string }>,
  ): Promise<void> {
    try {
      const value = await Promise.resolve(getValue())
      await this.writeTextFile(targetPath, `${JSON.stringify(value, null, 2)}\n`)
      included.push(relativePath)
    } catch (error) {
      skipped.push({ path: relativePath, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  private async copyOptionalFile(
    sourcePath: string,
    targetPath: string,
    relativePath: string,
    included: string[],
    skipped: Array<{ path: string; reason: string }>,
    copy: () => void | Promise<void> = () => this.copyFile(sourcePath, targetPath),
  ): Promise<void> {
    try {
      await Promise.resolve(copy())
      included.push(relativePath)
    } catch (error) {
      skipped.push({ path: relativePath, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  private async copyLogFiles(
    packageRoot: string,
    included: string[],
    skipped: Array<{ path: string; reason: string }>,
  ): Promise<void> {
    await this.deps.logStore.flush()
    const logDirectory = this.deps.logStore.getLogDirectory()
    const logFiles = await this.deps.logStore.listLogFilesInfo()

    for (const file of logFiles) {
      const fileName = path.basename(file.name)
      const relativePath = `logs/${fileName}`
      await this.copyOptionalFile(
        path.join(logDirectory, fileName),
        path.join(packageRoot, relativePath),
        relativePath,
        included,
        skipped,
      )
    }
  }

  private ok(
    id: string,
    group: string,
    name: string,
    message: string,
    details?: Record<string, unknown>,
  ): SynapseDiagnosticsCheck {
    return { id, group, name, status: "ok", severity: "info", message, details }
  }

  private degraded(
    id: string,
    group: string,
    name: string,
    message: string,
    details?: Record<string, unknown>,
  ): SynapseDiagnosticsCheck {
    return { id, group, name, status: "degraded", severity: "warning", message, details }
  }

  private failed(
    id: string,
    group: string,
    name: string,
    message: string,
    details?: Record<string, unknown>,
  ): SynapseDiagnosticsCheck {
    return { id, group, name, status: "failed", severity: "error", message, details }
  }

  private statPath(targetPath: string): Promise<PathStats> {
    return (this.deps.statPath ?? stat)(targetPath)
  }

  private writeReadDeleteProbe(directoryPath: string): Promise<void> {
    return (this.deps.writeReadDeleteProbe ?? writeReadDeleteProbe)(directoryPath)
  }

  private chooseSavePath(defaultFileName: string): Promise<string | null> {
    if (this.deps.chooseSavePath) return this.deps.chooseSavePath(defaultFileName)
    return Promise.resolve(path.join(this.deps.appInfo.getPath("downloads"), defaultFileName))
  }

  private makeTempDir(prefix: string): Promise<string> {
    return this.deps.makeTempDir?.(prefix) ?? mkdtemp(path.join(os.tmpdir(), prefix))
  }

  private writeTextFile(targetPath: string, content: string): Promise<void> {
    return this.deps.writeTextFile?.(targetPath, content) ?? writeFile(targetPath, content, "utf8")
  }

  private copyFile(sourcePath: string, targetPath: string): Promise<void> {
    return this.deps.copyFile?.(sourcePath, targetPath) ?? copyFile(sourcePath, targetPath)
  }

  private createZipArchive(sourceDirectoryPath: string, outputFilePath: string): Promise<void> {
    if (!this.deps.createZipArchive) {
      throw new Error("createZipArchive dependency is not configured")
    }
    return this.deps.createZipArchive(sourceDirectoryPath, outputFilePath)
  }

  private removePath(targetPath: string): Promise<void> {
    return this.deps.removePath?.(targetPath) ?? rm(targetPath, { recursive: true, force: true })
  }

  private async createConfigBackupPayload(): Promise<unknown> {
    if (this.deps.createConfigBackupPayload) {
      return this.deps.createConfigBackupPayload()
    }

    const backupService = await import("./config-backup-service.js")
    return backupService.createConfigBackupPayload()
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private platformInfo(): PlatformInfo {
    const cpus = os.cpus()
    return this.deps.platformInfo?.() ?? {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      node: process.version,
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      pid: process.pid,
      hostname: os.hostname(),
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      uptimeSeconds: os.uptime(),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model,
    }
  }
}

async function writeReadDeleteProbe(directoryPath: string): Promise<void> {
  const probeDir = await mkdtemp(path.join(directoryPath, "synapse-diagnostics-"))
  const probeFile = path.join(probeDir, "probe.txt")
  try {
    await writeFile(probeFile, "ok", "utf8")
    const entries = await readdir(probeDir)
    if (!entries.includes("probe.txt")) {
      throw new Error("probe file was not written")
    }
  } finally {
    await rm(probeDir, { recursive: true, force: true })
  }
}

function resolveActiveProject(config: SynapseConfig, projectId?: string) {
  return projectId
    ? config.global.projects.find((item) => item.id === projectId)
    : config.global.projects[0]
}

function createDiagnosticsFolderName(generatedAt: string): string {
  return `synapse-diagnostics-${generatedAt.replace(/[:.]/g, "-")}`
}

function createEmptyConfig(): SynapseConfig {
  return {
    activeRepoUuid: null,
    repositories: [],
    global: {
      themeMode: "system",
      projects: [],
      favorites: { rule: [], skill: [], prompt: [] },
      recentlyViewed: { rule: [], skill: [], prompt: [] },
      contentSortOrder: "modified-desc",
    },
  }
}

export {
  DiagnosticsService,
  createDiagnosticsFolderName,
  summarizeDiagnosticsChecks,
}
export type { DiagnosticsServiceDeps }
