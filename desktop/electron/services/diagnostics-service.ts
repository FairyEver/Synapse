import { copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { SynapseConfig } from "../../src/types/config"
import {
  buildDiagnosticsSummary,
  summarizeDiagnosticsChecks,
} from "../../src/lib/diagnostics-summary"
import type {
  SynapseDiagnosticsBundleExportResult,
  SynapseDiagnosticsCheck,
  SynapseDiagnosticsReport,
} from "../../src/types/diagnostics"
import type {
  DatabaseMcpHttpStatus,
  DatabaseMcpServerInfo,
  DatabaseStatus,
} from "../../src/types/database"
import type { SynapseOpsDiagnostics } from "../../src/types/bridge"
import type { DataRepository } from "../runtime/data-repo"
import type { StructuredLogger } from "../runtime/logging"
import type { ServiceRegistry } from "../runtime/service-registry"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import type { ServiceResolver } from "../modules/ops/status"
import {
  createMacCompatibilitySnapshot,
  type MacCompatibilitySnapshot,
} from "./mac-compatibility"
import {
  createWindowsCompatibilitySnapshot,
  inspectWindowsConfiguredPaths,
  summarizeWindowsCompatibilityLogSignals,
  type WindowsCompatibilitySnapshot,
} from "./windows-compatibility"

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
  readLogsByNames(fileNames: string[]): Promise<string>
}

type DatabaseLike = {
  exportDatabase(targetPath: string): void
  getDbPath(): string
  getDbSize(): number
  getDiagnosticsHealth(): {
    quickCheck: string
    metaTableCount: number
    metaColumnCount: number
    operationLogCount: number
  }
  getTableCount(): number
}

type MaybePromise<T> = T | Promise<T>

type CliDebugInfo = Record<string, unknown> & {
  installPathCandidates?: unknown
  installedPath?: unknown
  preferredInstallPath?: unknown
  status?: {
    available?: boolean
  }
}

type McpHttpProbeResult = {
  ok: boolean
  method: string
  status?: number
  error?: string
}

type DiagnosticsServiceDeps = {
  appInfo: AppInfo
  configStore: ConfigStoreLike
  dataRepository: Pick<DataRepository, "inspect">
  serviceRegistry: Pick<ServiceRegistry, "get" | "inspect">
  logStore: LogStoreLike
  database: DatabaseLike
  getDatabaseRuntimeStatus: () => DatabaseStatus
  collectOpsStatus: (
    resolve: ServiceResolver,
    request?: { projectId?: string },
  ) => Promise<SynapseOpsDiagnostics>
  getCliDebugInfo: () => Promise<CliDebugInfo>
  getMcpHttpStatus: () => DatabaseMcpHttpStatus
  getMcpServers: () => MaybePromise<DatabaseMcpServerInfo[]>
  probeMcpHttp: (url: string) => Promise<McpHttpProbeResult>
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

const RECENT_LOG_FILE_LIMIT = 3
const RECENT_LOG_SAMPLE_LIMIT = 5
const LIFECYCLE_LOG_SAMPLE_LIMIT = 5

type RecentLogSnapshot = {
  scannedFiles: string[]
  content: string
}

type LogTimestamp = {
  iso: string
  ms: number
}

type ServiceLifecycleSummary = {
  hasSignals: boolean
  runCount: number
  shutdownCount: number
  rendererBootstrapCount: number
  appMountedCount: number
  latestStartedAt?: string
  latestStartupDurationsMs: Record<string, number>
  latestRunRendererBootstrapCount: number
  latestRunAppMountedCount: number
  restartTrace: boolean
  rendererRestartTrace: boolean
  samples: string[]
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
    const platformInfo = this.platformInfo()
    const windowsCompatibility = this.createWindowsCompatibilitySnapshot(platformInfo)
    const macCompatibility = this.createMacCompatibilitySnapshot(platformInfo)
    const config = await this.loadConfig(checks)
    const activeProject = resolveActiveProject(config, payload.projectId)
    const activeRepository = config.repositories.find((item) => item.uuid === config.activeRepoUuid)

    checks.push(this.ok("system.process", "系统", "进程", "系统信息已读取", platformInfo))
    checks.push(this.ok("app.version", "应用", "版本", this.deps.appInfo.getVersion(), {
      appName: this.deps.appInfo.getName(),
      appPath: this.deps.appInfo.getAppPath(),
      locale: this.deps.appInfo.getLocale(),
      isPackaged: this.deps.appInfo.isPackaged,
      singleInstanceLocked: this.deps.appInfo.hasSingleInstanceLock(),
    }))

    await this.addPathChecks(checks, config)
    await this.addWindowsCompatibilityChecks(checks, config, windowsCompatibility)
    await this.addLogChecks(checks)
    await this.addDatabaseChecks(checks)
    await this.addInspectChecks(checks)
    await this.addOpsChecks(checks, payload.projectId)

    const { overallStatus, summary } = summarizeDiagnosticsChecks(checks)

    return {
      schemaVersion: 1,
      generatedAt,
      overallStatus,
      summary,
      system: {
        ...platformInfo,
        windowsCompatibility,
        macCompatibility,
      },
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
      await mkdir(path.join(packageRoot, "database"), { recursive: true })

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

      await this.writeTextFile(
        path.join(packageRoot, "summary.md"),
        `${buildDiagnosticsSummary(report)}\n`,
      )
      included.push("summary.md")

      await this.writeOptionalJsonFile(
        path.join(packageRoot, "config", "config-backup.json"),
        "config/config-backup.json",
        () => this.createConfigBackupPayload(),
        included,
        skipped,
      )

      const databaseTargetPath = path.join(packageRoot, "database", "synapse-database.db")
      await this.copyOptionalFile(
        this.deps.database.getDbPath(),
        databaseTargetPath,
        "database/synapse-database.db",
        included,
        skipped,
        () => this.deps.database.exportDatabase(databaseTargetPath),
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
    let recentLogSnapshot: RecentLogSnapshot | null = null
    const readRecentLogSnapshot = async () => {
      recentLogSnapshot ??= await this.readRecentLogSnapshot()
      return recentLogSnapshot
    }

    await this.capture(checks, "logs.files", "日志与配置", "日志文件", async () => {
      const files = await this.deps.logStore.listLogFilesInfo()
      return this.ok("logs.files", "日志与配置", "日志文件", "日志信息已读取", {
        count: files.length,
        totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
        logPath: this.deps.logStore.getLogDirectory(),
      })
    })

    await this.capture(checks, "logs.recent-signals", "日志与配置", "近期日志", async () => {
      const { scannedFiles, content } = await readRecentLogSnapshot()
      const signals = summarizeLogSignals(content)
      const details = {
        logPath: this.deps.logStore.getLogDirectory(),
        scannedFiles,
        warningCount: signals.warningCount,
        errorCount: signals.errorCount,
        samples: signals.samples,
      }

      return signals.warningCount + signals.errorCount > 0
        ? this.degraded("logs.recent-signals", "日志与配置", "近期日志", "近期日志包含警告或错误", details)
        : this.ok("logs.recent-signals", "日志与配置", "近期日志", "未发现近期警告", details)
    })

    await this.capture(checks, "logs.lifecycle", "日志与配置", "启动与重启", async () => {
      const { scannedFiles, content } = await readRecentLogSnapshot()
      const lifecycle = summarizeServiceLifecycle(content)
      const details = {
        logPath: this.deps.logStore.getLogDirectory(),
        scannedFiles,
        ...lifecycle,
      }

      if (!lifecycle.hasSignals) {
        return this.skipped("logs.lifecycle", "日志与配置", "启动与重启", "未找到启动日志", details)
      }

      if (lifecycle.rendererRestartTrace) {
        return this.degraded("logs.lifecycle", "日志与配置", "启动与重启", "发现 renderer 重启痕迹", details)
      }

      return this.ok(
        "logs.lifecycle",
        "日志与配置",
        "启动与重启",
        lifecycle.restartTrace ? "启动耗时已读取，近期有退出或重启痕迹" : "启动耗时已读取",
        details,
      )
    })

    await this.capture(checks, "logs.windows-compatibility", "日志与配置", "Windows 兼容日志", async () => {
      const { scannedFiles, content } = await readRecentLogSnapshot()
      const signals = summarizeWindowsCompatibilityLogSignals(content)
      const details = {
        logPath: this.deps.logStore.getLogDirectory(),
        scannedFiles,
        ...signals,
      }

      if (signals.errorCount > 0) {
        return this.degraded(
          "logs.windows-compatibility",
          "日志与配置",
          "Windows 兼容日志",
          "近期日志包含 Windows 兼容性错误信号",
          details,
        )
      }

      if (signals.warningCount > 0) {
        return this.degraded(
          "logs.windows-compatibility",
          "日志与配置",
          "Windows 兼容日志",
          "近期日志包含 Windows 兼容性风险信号",
          details,
        )
      }

      return this.ok(
        "logs.windows-compatibility",
        "日志与配置",
        "Windows 兼容日志",
        "未发现 Windows 兼容性风险日志",
        details,
      )
    })
  }

  private async addWindowsCompatibilityChecks(
    checks: SynapseDiagnosticsCheck[],
    config: SynapseConfig,
    snapshot: WindowsCompatibilitySnapshot,
  ): Promise<void> {
    await this.capture(checks, "windows.environment", "Windows 兼容性", "环境变量", async () => {
      const pathextEntries = snapshot.env.pathextEntries.map((entry) => entry.toUpperCase())
      const missingExecutableExtensions = [".EXE", ".CMD", ".BAT"].filter((entry) => !pathextEntries.includes(entry))
      const details = {
        platform: snapshot.platform,
        arch: snapshot.arch,
        release: snapshot.release,
        runningOnWindows: snapshot.runningOnWindows,
        pathDelimiter: snapshot.pathDelimiter,
        ...snapshot.env,
        missingExecutableExtensions,
      }

      if (!snapshot.runningOnWindows) {
        return this.skipped(
          "windows.environment",
          "Windows 兼容性",
          "环境变量",
          "当前不是 Windows，已采集环境基线",
          details,
        )
      }

      if (snapshot.env.missingRequiredKeys.length > 0 || missingExecutableExtensions.length > 0) {
        return this.degraded(
          "windows.environment",
          "Windows 兼容性",
          "环境变量",
          "Windows 关键环境变量不完整",
          details,
        )
      }

      return this.ok("windows.environment", "Windows 兼容性", "环境变量", "Windows 关键环境变量已采集", details)
    })

    await this.capture(checks, "windows.writable-data", "Windows 兼容性", "数据目录", async () => {
      const details = snapshot.paths
      const appDataInsideInstallPath = details.userDataInsideAppPath
        || details.logInsideAppPath
        || details.dbInsideAppPath

      if (!snapshot.runningOnWindows) {
        return this.skipped(
          "windows.writable-data",
          "Windows 兼容性",
          "数据目录",
          "当前不是 Windows，已采集路径基线",
          details,
        )
      }

      if (appDataInsideInstallPath) {
        return this.degraded(
          "windows.writable-data",
          "Windows 兼容性",
          "数据目录",
          "应用数据目录可能位于安装目录内",
          details,
        )
      }

      return this.ok("windows.writable-data", "Windows 兼容性", "数据目录", "应用数据目录未落在安装目录内", details)
    })

    await this.capture(checks, "windows.configured-paths", "Windows 兼容性", "配置路径", async () => {
      const pathSummary = inspectWindowsConfiguredPaths([
        ...config.repositories.map((repository) => ({
          kind: "repository" as const,
          id: repository.uuid,
          name: repository.name,
          path: repository.localPath,
        })),
        ...config.global.projects.map((project) => ({
          kind: "project" as const,
          id: project.id,
          name: project.name,
          path: project.path,
        })),
      ])

      if (!snapshot.runningOnWindows) {
        return this.skipped(
          "windows.configured-paths",
          "Windows 兼容性",
          "配置路径",
          "当前不是 Windows，已采集配置路径基线",
          pathSummary,
        )
      }

      if (
        pathSummary.unsafeEntryCount > 0
        || pathSummary.nonAbsoluteEntryCount > 0
        || pathSummary.nonFullyQualifiedEntryCount > 0
        || pathSummary.duplicatePathGroups.length > 0
      ) {
        return this.degraded(
          "windows.configured-paths",
          "Windows 兼容性",
          "配置路径",
          "配置路径包含 Windows 风险",
          pathSummary,
        )
      }

      return this.ok("windows.configured-paths", "Windows 兼容性", "配置路径", "配置路径已通过 Windows 基础检查", pathSummary)
    })
  }

  private async readRecentLogSnapshot(): Promise<RecentLogSnapshot> {
    const files = await this.deps.logStore.listLogFilesInfo()
    const scannedFiles = files.slice(0, RECENT_LOG_FILE_LIMIT).map((file) => file.name)
    const content = scannedFiles.length > 0
      ? await this.deps.logStore.readLogsByNames(scannedFiles)
      : ""

    return { scannedFiles, content }
  }

  private async addDatabaseChecks(checks: SynapseDiagnosticsCheck[]): Promise<void> {
    await this.capture(checks, "database.status", "Database", "数据库", async () => {
      const runtimeStatus = this.deps.getDatabaseRuntimeStatus()
      const details = {
        ...runtimeStatus,
        dbPath: this.deps.database.getDbPath(),
        dbSize: this.deps.database.getDbSize(),
        tableCount: this.deps.database.getTableCount(),
      }
      return runtimeStatus.running
        ? this.ok("database.status", "Database", "数据库", "数据库状态已读取", details)
        : this.degraded("database.status", "Database", "数据库", "数据库未运行", details)
    })

    await this.capture(checks, "database.integrity", "Database", "完整性", async () => {
      const runtimeStatus = this.deps.getDatabaseRuntimeStatus()
      if (!runtimeStatus.running) {
        return this.degraded("database.integrity", "Database", "完整性", "数据库未运行，未执行完整性检查", runtimeStatus)
      }

      const health = this.deps.database.getDiagnosticsHealth()
      const details = {
        ...health,
        tableCount: this.deps.database.getTableCount(),
        dbPath: this.deps.database.getDbPath(),
        dbSize: this.deps.database.getDbSize(),
      }

      return health.quickCheck === "ok"
        ? this.ok("database.integrity", "Database", "完整性", "数据库完整", details)
        : this.failed("database.integrity", "Database", "完整性", "数据库完整性检查失败", details)
    })

    await this.capture(checks, "database.cli", "Database", "CLI", async () => {
      const debugInfo = await this.deps.getCliDebugInfo()
      const available = debugInfo.status?.available === true
      const pathAnalysis = analyzeCliPaths(debugInfo)
      const details = { ...debugInfo, pathAnalysis }

      if (!available) {
        return this.degraded("database.cli", "Database", "CLI", "CLI 不可用", details)
      }

      return pathAnalysis.installedPath
        && pathAnalysis.preferredInstallPath
        && pathAnalysis.installedPath !== pathAnalysis.preferredInstallPath
        ? this.degraded("database.cli", "Database", "CLI", "CLI 可用，命中路径不是推荐位置", details)
        : this.ok("database.cli", "Database", "CLI", "CLI 可用", details)
    })

    await this.capture(checks, "database.mcp", "Database", "MCP", async () => {
      const http = this.deps.getMcpHttpStatus()
      const registrations = await Promise.resolve(this.deps.getMcpServers())
      const probe = http.running && http.url
        ? await this.probeMcpHttp(http.url)
        : { ok: false, method: "ping", error: "MCP HTTP 未运行" }
      const unregistered = registrations.filter((server) => !server.registered)
      const details = {
        http,
        probe,
        registrations,
        unregisteredTargets: unregistered.map((server) => server.target),
      }

      if (!http.running) {
        return this.degraded("database.mcp", "Database", "MCP", "MCP HTTP 未运行", details)
      }
      if (!probe.ok) {
        return this.degraded("database.mcp", "Database", "MCP", "MCP ping 失败", details)
      }

      return this.ok("database.mcp", "Database", "MCP", "MCP 可用", details)
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

  private async probeMcpHttp(url: string): Promise<McpHttpProbeResult> {
    const permission = await this.deps.permissionGuard.check({
      action: "network.connect",
      actor: { kind: "user" },
      resource: url,
      context: { source: "ops.runDiagnostics", target: "database.mcp" },
    })

    if (!permission.allowed) {
      this.deps.auditSink.record({
        action: "network.connect",
        actor: { kind: "user" },
        resource: url,
        outcome: "denied",
        metadata: {
          source: "ops.runDiagnostics",
          target: "database.mcp",
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      return { ok: false, method: "ping", error: permission.reason }
    }

    try {
      const result = await this.deps.probeMcpHttp(url)
      this.deps.auditSink.record({
        action: "network.connect",
        actor: { kind: "user" },
        resource: url,
        outcome: "allowed",
        metadata: { source: "ops.runDiagnostics", target: "database.mcp" },
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.auditSink.record({
        action: "network.connect",
        actor: { kind: "user" },
        resource: url,
        outcome: "failed",
        metadata: { source: "ops.runDiagnostics", target: "database.mcp", error: message },
      })
      return { ok: false, method: "ping", error: message }
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

  private skipped(
    id: string,
    group: string,
    name: string,
    message: string,
    details?: Record<string, unknown>,
  ): SynapseDiagnosticsCheck {
    return { id, group, name, status: "skipped", severity: "info", message, details }
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

  private createWindowsCompatibilitySnapshot(platformInfo: PlatformInfo): WindowsCompatibilitySnapshot {
    return createWindowsCompatibilitySnapshot({
      platform: typeof platformInfo.platform === "string" ? platformInfo.platform : process.platform,
      arch: typeof platformInfo.arch === "string" ? platformInfo.arch : process.arch,
      release: typeof platformInfo.release === "string" ? platformInfo.release : os.release(),
      paths: {
        appPath: this.deps.appInfo.getAppPath(),
        cwd: process.cwd(),
        userDataPath: this.deps.appInfo.getPath("userData"),
        tempPath: this.deps.appInfo.getPath("temp"),
        downloadsPath: this.deps.appInfo.getPath("downloads"),
        logPath: this.deps.logStore.getLogDirectory(),
        dbPath: this.deps.database.getDbPath(),
      },
    })
  }

  private createMacCompatibilitySnapshot(platformInfo: PlatformInfo): MacCompatibilitySnapshot {
    return createMacCompatibilitySnapshot({
      platform: typeof platformInfo.platform === "string" ? platformInfo.platform : process.platform,
      arch: typeof platformInfo.arch === "string" ? platformInfo.arch : process.arch,
      release: typeof platformInfo.release === "string" ? platformInfo.release : os.release(),
      paths: {
        appPath: this.deps.appInfo.getAppPath(),
        cwd: process.cwd(),
        userDataPath: this.deps.appInfo.getPath("userData"),
        tempPath: this.deps.appInfo.getPath("temp"),
        downloadsPath: this.deps.appInfo.getPath("downloads"),
        logPath: this.deps.logStore.getLogDirectory(),
        dbPath: this.deps.database.getDbPath(),
      },
    })
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

function summarizeLogSignals(content: string): {
  warningCount: number
  errorCount: number
  samples: string[]
} {
  const samples: string[] = []
  let warningCount = 0
  let errorCount = 0

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const isError = /\[ERROR\s*\]/.test(line)
      || /\b(error|exception|uncaught|unhandled|ERR_[A-Z_]+)\b/i.test(line)
    const isWarning = /\[WARN\s*\]/.test(line)
      || /\b(warn|warning|EPIPE|timeout|failed|denied|EACCES|ENOENT)\b/i.test(line)

    if (!isError && !isWarning) continue

    if (isError) {
      errorCount += 1
    } else {
      warningCount += 1
    }

    if (samples.length < RECENT_LOG_SAMPLE_LIMIT) {
      samples.push(line.length > 300 ? `${line.slice(0, 300)}...` : line)
    }
  }

  return { warningCount, errorCount, samples }
}

function summarizeServiceLifecycle(content: string): ServiceLifecycleSummary {
  const samples: string[] = []
  let latestStartupDurationsMs: Record<string, number> = {}
  let runCount = 0
  let shutdownCount = 0
  let rendererBootstrapCount = 0
  let appMountedCount = 0
  let latestStartedAt: string | undefined
  let latestStartedMs: number | undefined
  let latestRunRendererBootstrapCount = 0
  let latestRunAppMountedCount = 0

  const recordSample = (line: string) => {
    if (samples.length >= LIFECYCLE_LOG_SAMPLE_LIMIT) return
    samples.push(line.length > 300 ? `${line.slice(0, 300)}...` : line)
  }

  const recordDuration = (key: string, timestamp: LogTimestamp | null) => {
    if (!timestamp || latestStartedMs === undefined || timestamp.ms < latestStartedMs) return
    latestStartupDurationsMs[key] = timestamp.ms - latestStartedMs
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const timestamp = parseLogTimestamp(line)

    if (line.includes("Electron app is ready. Initializing IPC registry.")) {
      runCount += 1
      latestStartedAt = timestamp?.iso
      latestStartedMs = timestamp?.ms
      latestStartupDurationsMs = {}
      latestRunRendererBootstrapCount = 0
      latestRunAppMountedCount = 0
      recordDuration("electronReady", timestamp)
      recordSample(line)
      continue
    }

    if (line.includes("Database HTTP server ready.")) {
      recordDuration("databaseHttpReady", timestamp)
      recordSample(line)
      continue
    }

    if (line.includes("MCP HTTP server ready.")) {
      recordDuration("mcpHttpReady", timestamp)
      recordSample(line)
      continue
    }

    if (line.includes("Database initialized.")) {
      recordDuration("databaseInitialized", timestamp)
      recordSample(line)
      continue
    }

    if (line.includes("Service registry started. Creating main window.")) {
      recordDuration("serviceRegistryStarted", timestamp)
      recordSample(line)
      continue
    }

    if (line.includes("Main window is ready to show.")) {
      recordDuration("mainWindowReady", timestamp)
      recordSample(line)
      continue
    }

    if (line.includes("Renderer bootstrap started.")) {
      rendererBootstrapCount += 1
      latestRunRendererBootstrapCount += 1
      recordDuration("rendererBootstrapStarted", timestamp)
      recordSample(line)
      continue
    }

    if (line.includes("App mounted.")) {
      appMountedCount += 1
      latestRunAppMountedCount += 1
      recordDuration("appMounted", timestamp)
      recordSample(line)
      continue
    }

    if (line.includes("Shutting down database.") || line.includes("Database shut down.")) {
      shutdownCount += 1
      recordSample(line)
    }
  }

  const hasSignals = runCount > 0
    || shutdownCount > 0
    || rendererBootstrapCount > 0
    || appMountedCount > 0
  const rendererRestartTrace = latestRunRendererBootstrapCount > 1 || latestRunAppMountedCount > 1

  return {
    hasSignals,
    runCount,
    shutdownCount,
    rendererBootstrapCount,
    appMountedCount,
    latestStartedAt,
    latestStartupDurationsMs,
    latestRunRendererBootstrapCount,
    latestRunAppMountedCount,
    restartTrace: runCount > 1 || shutdownCount > 0,
    rendererRestartTrace,
    samples,
  }
}

function parseLogTimestamp(line: string): LogTimestamp | null {
  const match = /^\[(?<timestamp>[^\]]+)\]/.exec(line)
  const timestamp = match?.groups?.timestamp
  if (!timestamp) return null

  const ms = Date.parse(timestamp)
  if (Number.isNaN(ms)) return null

  return { iso: new Date(ms).toISOString(), ms }
}

function analyzeCliPaths(debugInfo: CliDebugInfo): {
  installedPath: string | null
  preferredInstallPath: string | null
  candidateCount: number
} {
  const installedPath = typeof debugInfo.installedPath === "string" && debugInfo.installedPath
    ? debugInfo.installedPath
    : null
  const preferredInstallPath =
    typeof debugInfo.preferredInstallPath === "string" && debugInfo.preferredInstallPath
      ? debugInfo.preferredInstallPath
      : null
  const candidates = Array.isArray(debugInfo.installPathCandidates)
    ? new Set(debugInfo.installPathCandidates.filter((item): item is string => typeof item === "string"))
    : new Set<string>()

  return {
    installedPath,
    preferredInstallPath,
    candidateCount: candidates.size,
  }
}

export {
  DiagnosticsService,
  createDiagnosticsFolderName,
  summarizeDiagnosticsChecks,
  summarizeLogSignals,
  summarizeServiceLifecycle,
}
export type { DiagnosticsServiceDeps }
