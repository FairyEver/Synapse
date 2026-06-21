import { execFile } from "node:child_process"
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { DEFAULT_AGENT_GLOBAL_CONFIG } from "../../src/constants/defaults"
import type { SynapseConfig } from "../../src/types/config"
import {
  buildDiagnosticsSummary,
  summarizeDiagnosticsChecks,
} from "../../src/lib/diagnostics-summary"
import { redactSensitiveText } from "../../src/lib/agent-redaction"
import { errorLogMessage, sanitizeError } from "../../src/lib/error-sanitize"
import { sanitizeUrl } from "../../src/lib/url-sanitize"
import type {
  SynapseDiagnosticsBundleExportResult,
  SynapseDiagnosticsCheck,
  SynapseKnowledgeBaseStorageDiagnostics,
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
import {
  collectShellEnvironmentSnapshot,
  type ShellEnvironmentSnapshot,
} from "../runtime/process"
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
import {
  inspectPackagedClaudeRuntime,
  PACKAGED_CLAUDE_RUNTIME_MISSING_MESSAGE,
  resourcesPathFromAppPath,
  type PackagedClaudeRuntimeStatus,
} from "./agent-runtime/claude-runtime-binary"
import { isManagedKnowledgeBaseProject, resolveProjectWorkspacePath } from "./knowledge-base/managed-path"
import { resolveKnowledgeBasesDirectory, resolveKnowledgeBaseStorageRoot } from "./knowledge-base/storage-root"

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
  size?: number
}

type DirectoryEntry = {
  name: string
  isDirectory(): boolean
  isFile(): boolean
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

type McpHttpProbeResult = {
  ok: boolean
  method: string
  status?: number
  error?: string
}

type GitVersionProbeResult =
  | { ok: true; version: string }
  | { ok: false; error: string }

type DiagnosticsExecFile = (
  file: string,
  args: readonly string[],
  options: {
    timeout: number
    env?: NodeJS.ProcessEnv
    windowsHide?: boolean
  },
  callback: (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void,
) => void

type CodexRuntimeProcessDiagnostics = {
  pid: number
  command: string
  startedAtText?: string
  startedAt?: string
  startedAtMs?: number
}

type CodexRuntimeDiagnostics = {
  settingsPath: string
  settingsFileExists: boolean
  settingsModifiedAt?: string
  settingsModifiedMs?: number
  settingsStatError?: string
  processes: CodexRuntimeProcessDiagnostics[]
  processStartedBeforeConfigModified: boolean
  warning?: string
  processListError?: string
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
  getMcpHttpStatus: () => DatabaseMcpHttpStatus
  getMcpServers: () => MaybePromise<DatabaseMcpServerInfo[]>
  probeMcpHttp: (url: string) => Promise<McpHttpProbeResult>
  permissionGuard: PermissionGuard
  auditSink: AuditSink
  logger: StructuredLogger
  now?: () => Date
  platformInfo?: () => PlatformInfo
  statPath?: (targetPath: string) => Promise<PathStats>
  readDirectory?: (targetPath: string) => Promise<DirectoryEntry[]>
  readTextFile?: (targetPath: string) => Promise<string>
  writeReadDeleteProbe?: (directoryPath: string) => Promise<void>
  chooseSavePath?: (defaultFileName: string) => Promise<string | null>
  makeTempDir?: (prefix: string) => Promise<string>
  writeTextFile?: (targetPath: string, content: string) => Promise<void>
  copyFile?: (sourcePath: string, targetPath: string) => Promise<void>
  createZipArchive?: (sourceDirectoryPath: string, outputFilePath: string) => Promise<void>
  removePath?: (targetPath: string) => Promise<void>
  collectShellEnvironment?: () => ShellEnvironmentSnapshot
  probeGitVersion?: (input: { gitPath: string; effectivePath: string }) => Promise<GitVersionProbeResult>
  inspectClaudeRuntime?: () => PackagedClaudeRuntimeStatus
  collectCodexRuntimeDiagnostics?: (input: { settingsPath: string }) => Promise<CodexRuntimeDiagnostics>
}

const RECENT_LOG_FILE_LIMIT = 3
const RECENT_LOG_SAMPLE_LIMIT = 5
const LIFECYCLE_LOG_SAMPLE_LIMIT = 5
const AGENT_LOG_SAMPLE_LIMIT = 5
const DIAGNOSTICS_LOG_EXPORT_MAX_FILES = 5
const DIAGNOSTICS_LOG_EXPORT_MAX_BYTES = 50 * 1024 * 1024
const KNOWLEDGE_BASE_OLD_REFERENCE_MAX_TEXT_FILES = 64
const KNOWLEDGE_BASE_OLD_REFERENCE_MAX_BYTES = 512 * 1024
const KNOWLEDGE_BASE_OLD_REFERENCE_MAX_DEPTH = 4
const KNOWLEDGE_BASE_TEXT_FILE_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
])

type RecentLogSnapshot = {
  scannedFiles: string[]
  content: string
}

type KnowledgeBaseOldReferenceScanBudget = {
  bytesRead: number
  filesRead: number
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
    const knowledgeBaseStorage = await this.collectKnowledgeBaseStorageDiagnostics(config)
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
    this.addClaudeRuntimeCheck(checks, platformInfo)
    const shellEnvironment = this.collectShellEnvironmentSnapshot()
    this.addNodeVisibilityCheck(checks, shellEnvironment)
    await this.addGitVisibilityCheck(checks, shellEnvironment)

    this.addKnowledgeBaseStorageCheck(checks, knowledgeBaseStorage)
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
      knowledgeBaseStorage,
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

  private collectShellEnvironmentSnapshot(): ShellEnvironmentSnapshot {
    return this.deps.collectShellEnvironment
      ? this.deps.collectShellEnvironment()
      : collectShellEnvironmentSnapshot()
  }

  private addNodeVisibilityCheck(checks: SynapseDiagnosticsCheck[], snapshot: ShellEnvironmentSnapshot): void {
    const details = {
      "App PATH": snapshot.processPath,
      "Login Shell PATH": snapshot.shellPath,
      "最终 PATH": snapshot.effectivePath,
      "App PATH 中的 node": snapshot.processNodePath,
      "Login Shell 中的 node": snapshot.shellNodePath,
      "最终可用 node": snapshot.effectiveNodePath,
      "Synapse Node fallback 目录": snapshot.nodeRuntimeBinPath,
    }

    if (snapshot.effectiveNodePath) {
      checks.push(this.ok(
        "system.node-visibility",
        "系统",
        "Node 可见性",
        snapshot.processNodePath
          ? "Node 在 App PATH 中可用"
          : "Node 可通过登录 Shell PATH 或 Synapse runtime 使用",
        details,
      ))
      return
    }

    checks.push(this.degraded(
      "system.node-visibility",
      "系统",
      "Node 可见性",
      "未找到可用 Node",
      details,
    ))
  }

  private async addGitVisibilityCheck(checks: SynapseDiagnosticsCheck[], snapshot: ShellEnvironmentSnapshot): Promise<void> {
    const details = {
      "App PATH": snapshot.processPath,
      "Login Shell PATH": snapshot.shellPath,
      "最终 PATH": snapshot.effectivePath,
      "App PATH 中的 git": snapshot.processGitPath,
      "Login Shell 中的 git": snapshot.shellGitPath,
      "最终可用 git": snapshot.effectiveGitPath,
    }

    if (!snapshot.effectiveGitPath) {
      checks.push(this.degraded(
        "system.git-visibility",
        "系统",
        "Git 可见性",
        "未找到可用 Git",
        details,
      ))
      return
    }

    const probe = await this.probeGitVersion({
      gitPath: snapshot.effectiveGitPath,
      effectivePath: snapshot.effectivePath,
    })
    if (probe.ok) {
      checks.push(this.ok("system.git-visibility", "系统", "Git 可见性", "Git 可用", {
        ...details,
        version: probe.version,
      }))
      return
    }

    checks.push(this.degraded("system.git-visibility", "系统", "Git 可见性", "Git 不可执行", {
      ...details,
      error: probe.error,
    }))
  }

  private async probeGitVersion(input: { gitPath: string; effectivePath: string }): Promise<GitVersionProbeResult> {
    if (this.deps.probeGitVersion) {
      return this.deps.probeGitVersion(input)
    }
    return probeGitVersion(input)
  }

  private addClaudeRuntimeCheck(checks: SynapseDiagnosticsCheck[], platformInfo: PlatformInfo): void {
    const runtime = this.deps.inspectClaudeRuntime
      ? this.deps.inspectClaudeRuntime()
      : inspectPackagedClaudeRuntime({
          resourcesPath: resourcesPathFromAppPath(this.deps.appInfo.getAppPath()),
          platform: platformInfo.platform,
          arch: platformInfo.arch,
          isPackaged: this.deps.appInfo.isPackaged,
        })
    const details = {
      appVersion: this.deps.appInfo.getVersion(),
      isPackaged: this.deps.appInfo.isPackaged,
      ...runtime,
    }

    if (runtime.status === "present") {
      checks.push(this.ok("app.claude-runtime", "应用", "Claude runtime", "内置 Claude Code runtime 可用", details))
      return
    }
    if (runtime.status === "missing") {
      checks.push(this.failed("app.claude-runtime", "应用", "Claude runtime", PACKAGED_CLAUDE_RUNTIME_MISSING_MESSAGE, details))
      return
    }
    if (runtime.status === "unsupported-platform") {
      checks.push(this.degraded("app.claude-runtime", "应用", "Claude runtime", "当前平台未配置内置 Claude Code runtime", details))
      return
    }

    checks.push(this.skipped("app.claude-runtime", "应用", "Claude runtime", "开发环境未检查内置 Claude Code runtime", details))
  }

  async exportBundle(payload: { report: SynapseDiagnosticsReport }): Promise<SynapseDiagnosticsBundleExportResult> {
    const exportedAt = this.now().toISOString()
    const folderName = createDiagnosticsFolderName(exportedAt)
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
    const packageRoot = path.resolve(stagingRoot, folderName)
    if (!isPathInsideDirectory(packageRoot, stagingRoot)) {
      throw new Error("Diagnostics staging path is outside the staging root.")
    }
    const included: string[] = []
    const skipped: Array<{ path: string; reason: string }> = []

    try {
      await mkdir(path.join(packageRoot, "logs"), { recursive: true })
      await mkdir(path.join(packageRoot, "config"), { recursive: true })
      await mkdir(path.join(packageRoot, "database"), { recursive: true })

      const report = {
        ...payload.report,
        bundle: {
          lastExportedAt: exportedAt,
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
        path.join(packageRoot, "config", "config-summary.json"),
        "config/config-summary.json",
        () => this.createConfigDiagnosticsPayload(exportedAt),
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
      const message = error instanceof Error ? error.message : String(error)
      this.deps.auditSink.record({
        action: "fs.write",
        actor: { kind: "user" },
        resource: outputPath,
        outcome: "failed",
        metadata: {
          source: "ops.exportDiagnosticsBundle",
          errorName: error instanceof Error ? error.name : typeof error,
          errorLength: message.length,
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

  private async collectKnowledgeBaseStorageDiagnostics(
    config: SynapseConfig,
  ): Promise<SynapseKnowledgeBaseStorageDiagnostics> {
    const userDataPath = this.deps.appInfo.getPath("userData")
    const storage = config.global.knowledgeBaseStorage
    const rootPath = resolveKnowledgeBaseStorageRoot({ userDataPath, storage })
    const knowledgeBasesPath = resolveKnowledgeBasesDirectory({ userDataPath, storage })
    const managedProjects = config.global.projects.filter(isManagedKnowledgeBaseProject)
    const available = await this.isDirectoryAccessible(rootPath)
    let missingRuntimeCount = 0

    for (const project of managedProjects) {
      const runtimePath = resolveProjectWorkspacePath(project, { userDataPath, storage })
      if (!(await this.isDirectoryAccessible(runtimePath))) {
        missingRuntimeCount += 1
      }
    }

    const oldAbsoluteReferenceCount = storage.mode === "custom"
      ? await this.countOldKnowledgeBaseAbsoluteReferences({
          managedProjects,
          storage,
          userDataPath,
        })
      : 0

    return {
      mode: storage.mode,
      rootPath,
      knowledgeBasesPath,
      available,
      runtimeCount: managedProjects.length,
      missingRuntimeCount,
      oldAbsoluteReferenceCount,
    }
  }

  private addKnowledgeBaseStorageCheck(
    checks: SynapseDiagnosticsCheck[],
    diagnostics: SynapseKnowledgeBaseStorageDiagnostics,
  ): void {
    if (!diagnostics.available) {
      checks.push(this.failed(
        "knowledge-base.storage",
        "知识库",
        "存储位置",
        "知识库存储位置不可访问",
        diagnostics,
      ))
      return
    }

    if (diagnostics.missingRuntimeCount > 0 || diagnostics.oldAbsoluteReferenceCount > 0) {
      checks.push(this.degraded(
        "knowledge-base.storage",
        "知识库",
        "存储位置",
        "知识库存储存在需要检查的项目",
        diagnostics,
      ))
      return
    }

    checks.push(this.ok(
      "knowledge-base.storage",
      "知识库",
      "存储位置",
      "知识库存储可用",
      diagnostics,
    ))
  }

  private async isDirectoryAccessible(targetPath: string): Promise<boolean> {
    try {
      const pathStats = await this.statPath(targetPath)
      return pathStats.isDirectory()
    } catch (error) {
      this.deps.logger.debug("Diagnostics directory probe failed.", {
        targetPath,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  private async countOldKnowledgeBaseAbsoluteReferences(input: {
    managedProjects: SynapseConfig["global"]["projects"]
    storage: SynapseConfig["global"]["knowledgeBaseStorage"]
    userDataPath: string
  }): Promise<number> {
    const oldKnowledgeBasesPath = path.join(input.userDataPath, "knowledge-bases")
    const budget: KnowledgeBaseOldReferenceScanBudget = {
      bytesRead: 0,
      filesRead: 0,
    }

    for (const project of input.managedProjects) {
      const runtimePath = resolveProjectWorkspacePath(project, {
        userDataPath: input.userDataPath,
        storage: input.storage,
      })
      if (await this.hasTextOccurrenceInFile(
        path.join(runtimePath, ".raw", ".manifest.json"),
        oldKnowledgeBasesPath,
        budget,
      )) {
        return 1
      }
      if (await this.hasTextOccurrenceInDirectory(
        path.join(runtimePath, "wiki"),
        oldKnowledgeBasesPath,
        budget,
        0,
      )) {
        return 1
      }
    }

    return 0
  }

  private isKnowledgeBaseOldReferenceScanBudgetExhausted(budget: KnowledgeBaseOldReferenceScanBudget): boolean {
    return budget.filesRead >= KNOWLEDGE_BASE_OLD_REFERENCE_MAX_TEXT_FILES
      || budget.bytesRead >= KNOWLEDGE_BASE_OLD_REFERENCE_MAX_BYTES
  }

  private async hasTextOccurrenceInDirectory(
    directoryPath: string,
    needle: string,
    budget: KnowledgeBaseOldReferenceScanBudget,
    depth: number,
  ): Promise<boolean> {
    if (this.isKnowledgeBaseOldReferenceScanBudgetExhausted(budget)) return false
    if (depth > KNOWLEDGE_BASE_OLD_REFERENCE_MAX_DEPTH) {
      this.deps.logger.debug("Diagnostics knowledge base old reference scan depth limit reached.", {
        directoryPath,
        depth,
      })
      return false
    }

    let entries: DirectoryEntry[]
    try {
      entries = await this.readDirectory(directoryPath)
    } catch (error) {
      this.deps.logger.debug("Diagnostics directory scan skipped.", {
        directoryPath,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }

    for (const entry of entries) {
      if (this.isKnowledgeBaseOldReferenceScanBudgetExhausted(budget)) {
        this.deps.logger.debug("Diagnostics knowledge base old reference scan budget exhausted.", {
          directoryPath,
          filesRead: budget.filesRead,
          bytesRead: budget.bytesRead,
        })
        return false
      }

      const entryPath = path.join(directoryPath, entry.name)
      if (entry.isDirectory()) {
        if (await this.hasTextOccurrenceInDirectory(entryPath, needle, budget, depth + 1)) return true
      } else if (entry.isFile() && KNOWLEDGE_BASE_TEXT_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        if (await this.hasTextOccurrenceInFile(entryPath, needle, budget)) return true
      }
    }
    return false
  }

  private async hasTextOccurrenceInFile(
    filePath: string,
    needle: string,
    budget: KnowledgeBaseOldReferenceScanBudget,
  ): Promise<boolean> {
    if (this.isKnowledgeBaseOldReferenceScanBudgetExhausted(budget)) return false

    try {
      const pathStats = await this.statPath(filePath)
      const remainingBytes = KNOWLEDGE_BASE_OLD_REFERENCE_MAX_BYTES - budget.bytesRead
      if (typeof pathStats.size === "number" && pathStats.size > remainingBytes) {
        this.deps.logger.debug("Diagnostics knowledge base old reference file scan skipped by size limit.", {
          filePath,
          size: pathStats.size,
          remainingBytes,
        })
        return false
      }
    } catch (error) {
      this.deps.logger.debug("Diagnostics file stat skipped before scan.", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    budget.filesRead += 1
    try {
      const content = await this.readTextFile(filePath)
      budget.bytesRead += Buffer.byteLength(content, "utf8")
      return content.includes(needle)
    } catch (error) {
      this.deps.logger.debug("Diagnostics file scan skipped.", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
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
        const pathTarget = this.resolveProjectPathForDiagnostics(project, config)
        const pathStats = await this.statPath(pathTarget.resolvedPath)
        const details = pathTarget.resolvedPath === project.path
          ? { path: project.path }
          : { path: project.path, resolvedPath: pathTarget.resolvedPath }
        return pathStats.isDirectory()
          ? this.ok(`project.path.${project.id}`, "路径与权限", project.name, "目录可访问", details)
          : this.degraded(`project.path.${project.id}`, "路径与权限", project.name, "路径不是目录", details)
      })
    }
  }

  private resolveProjectPathForDiagnostics(
    project: SynapseConfig["global"]["projects"][number],
    config: SynapseConfig,
  ): {
    resolvedPath: string
  } {
    return {
      resolvedPath: isManagedKnowledgeBaseProject(project)
        ? resolveProjectWorkspacePath(project, {
            userDataPath: this.deps.appInfo.getPath("userData"),
            storage: config.global.knowledgeBaseStorage,
          })
        : project.path,
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

    await this.capture(checks, "logs.agent-runtime", "日志与配置", "Agent 日志", async () => {
      const { scannedFiles, content } = await readRecentLogSnapshot()
      const signals = summarizeAgentRuntimeLogSignals(content)
      const details = {
        logPath: this.deps.logStore.getLogDirectory(),
        scannedFiles,
        ...signals,
      }

      return signals.errorCount + signals.warningCount > 0
        ? this.degraded("logs.agent-runtime", "日志与配置", "Agent 日志", "近期日志包含 Agent/SDK 风险信号", details)
        : this.ok("logs.agent-runtime", "日志与配置", "Agent 日志", "未发现 Agent/SDK 风险日志", details)
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
          path: this.resolveProjectPathForDiagnostics(project, config).resolvedPath,
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

    await this.capture(checks, "database.mcp", "Database", "MCP", async () => {
      const http = this.deps.getMcpHttpStatus()
      const registrations = await Promise.resolve(this.deps.getMcpServers())
      const codexRegistration = registrations.find((server) => server.target === "codex")
      const codexRuntime = await this.collectCodexRuntimeDiagnostics(
        codexRegistration?.settingsPath ?? path.join(os.homedir(), ".codex", "config.toml"),
      )
      const probe = http.running && http.url
        ? await this.probeMcpHttp(http.url)
        : { ok: false, method: "ping", error: "MCP HTTP 未运行" }
      const unregistered = registrations.filter((server) => !server.registered)
      const details = {
        http,
        probe,
        registrations,
        codexRuntime,
        unregisteredTargets: unregistered.map((server) => server.target),
      }

      if (!http.running) {
        return this.degraded("database.mcp", "Database", "MCP", "MCP HTTP 未运行", details)
      }
      if (!probe.ok) {
        return this.degraded("database.mcp", "Database", "MCP", "MCP ping 失败", details)
      }
      if (codexRuntime.processListError) {
        return this.degraded("database.mcp", "Database", "MCP", "Codex 运行态检查失败", details)
      }

      return this.ok("database.mcp", "Database", "MCP", "MCP 可用", details)
    })
  }

  private async collectCodexRuntimeDiagnostics(settingsPath: string): Promise<CodexRuntimeDiagnostics> {
    if (this.deps.collectCodexRuntimeDiagnostics) {
      return this.deps.collectCodexRuntimeDiagnostics({ settingsPath })
    }
    return collectCodexRuntimeDiagnostics(settingsPath)
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
    await this.capture(checks, "ops.status", "运行", "运行状态", async () => {
      const status = await this.deps.collectOpsStatus(
        (serviceId) => this.deps.serviceRegistry.get(serviceId),
        projectId ? { projectId } : undefined,
      )
      return this.ok("ops.status", "运行", "运行状态", "运行状态已读取", status)
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
      skipped.push({ path: relativePath, reason: formatOptionalSkippedReason(error) })
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
      skipped.push({ path: relativePath, reason: formatOptionalSkippedReason(error) })
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
    const { selected, skipped: skippedLogs } = selectDiagnosticsLogFilesForExport(logFiles)
    skipped.push(...skippedLogs)

    for (const file of selected) {
      const fileName = path.basename(file.name)
      const relativePath = `logs/${fileName}`
      await this.copyOptionalFile(
        path.join(logDirectory, fileName),
        path.join(packageRoot, relativePath),
        relativePath,
        included,
        skipped,
        async () => this.copyRedactedLogFile(
          path.join(logDirectory, fileName),
          path.join(packageRoot, relativePath),
        ),
      )
    }
  }

  private async copyRedactedLogFile(sourcePath: string, targetPath: string): Promise<void> {
    const content = await this.readTextFile(sourcePath)
    await this.writeTextFile(targetPath, redactDiagnosticsLogContent(content))
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

  private readDirectory(targetPath: string): Promise<DirectoryEntry[]> {
    return this.deps.readDirectory?.(targetPath) ?? readdir(targetPath, { withFileTypes: true })
  }

  private readTextFile(targetPath: string): Promise<string> {
    return this.deps.readTextFile?.(targetPath) ?? readFile(targetPath, "utf8")
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

  private async createConfigDiagnosticsPayload(generatedAt: string): Promise<unknown> {
    const config = await this.deps.configStore.load()
    const favoriteCount = Object.values(config.global.favorites).reduce((sum, values) => sum + values.length, 0)
    const recentlyViewedCount = Object.values(config.global.recentlyViewed).reduce((sum, values) => sum + values.length, 0)
    return {
      schemaVersion: 1,
      generatedAt,
      repositories: {
        count: config.repositories.length,
        activeConfigured: Boolean(config.activeRepoUuid),
        contentDirectoryCount: config.repositories.reduce(
          (sum, repository) => sum + Object.values(repository.contentDirs).filter(Boolean).length,
          0,
        ),
      },
      projects: {
        count: config.global.projects.length,
        managedKnowledgeBaseCount: config.global.projects.filter(isManagedKnowledgeBaseProject).length,
      },
      variables: {
        count: config.global.variables.length,
        names: config.global.variables.map((variable) => variable.name),
      },
      knowledgeBaseStorage: {
        mode: config.global.knowledgeBaseStorage.mode,
        customRootConfigured: config.global.knowledgeBaseStorage.mode === "custom",
      },
      agent: {
        defaultPermissionMode: config.agent.defaultPermissionMode,
        defaultProviderModelConfigured: Boolean(config.agent.defaultProviderModel),
      },
      ui: {
        themeMode: config.global.themeMode,
        quickInputCount: config.global.quickInputs.length,
        favoriteCount,
        recentlyViewedCount,
        contentSortOrder: config.global.contentSortOrder,
      },
    }
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

function formatOptionalSkippedReason(error: unknown): string {
  return sanitizeError(errorLogMessage(error, "Optional diagnostic file skipped"))
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

function probeGitVersion(input: { gitPath: string; effectivePath: string }): Promise<GitVersionProbeResult> {
  return new Promise((resolve) => {
    execFile(input.gitPath, ["--version"], {
      timeout: 3000,
      env: {
        ...process.env,
        PATH: input.effectivePath,
        LANG: "C",
        LC_ALL: "C",
      },
    }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ ok: true, version: firstLine(stdout) || "git --version completed" })
        return
      }

      resolve({
        ok: false,
        error: truncateDiagnosticError(firstLine(stderr) || firstLine(stdout) || error.message),
      })
    })
  })
}

async function collectCodexRuntimeDiagnostics(settingsPath: string): Promise<CodexRuntimeDiagnostics> {
  const diagnostics: CodexRuntimeDiagnostics = {
    settingsPath,
    settingsFileExists: false,
    processes: [],
    processStartedBeforeConfigModified: false,
  }

  try {
    const stats = await stat(settingsPath)
    diagnostics.settingsFileExists = true
    diagnostics.settingsModifiedAt = stats.mtime.toISOString()
    diagnostics.settingsModifiedMs = stats.mtimeMs
  } catch (error) {
    diagnostics.settingsStatError = truncateDiagnosticError(errorLogMessage(error, "Codex config stat failed"))
  }

  const processList = await collectCodexProcesses()
  diagnostics.processes = processList.processes
  if (processList.error) {
    diagnostics.processListError = processList.error
  }

  if (diagnostics.settingsModifiedMs !== undefined) {
    diagnostics.processStartedBeforeConfigModified = diagnostics.processes.some((processInfo) =>
      processInfo.startedAtMs !== undefined && processInfo.startedAtMs < diagnostics.settingsModifiedMs!,
    )
  }

  if (diagnostics.processStartedBeforeConfigModified) {
    diagnostics.warning = "Codex 进程/会话早于 MCP 配置修改，旧会话可能未加载 Synapse MCP。"
  }

  return diagnostics
}

function collectCodexProcesses(input: {
  readonly platform?: NodeJS.Platform
  readonly execFile?: DiagnosticsExecFile
} = {}): Promise<{ processes: CodexRuntimeProcessDiagnostics[]; error?: string }> {
  const execFileImpl = input.execFile ?? (execFile as DiagnosticsExecFile)
  const platform = input.platform ?? process.platform
  if (platform === "win32") return collectWindowsCodexProcesses(execFileImpl)
  return collectPosixCodexProcesses(execFileImpl)
}

function collectPosixCodexProcesses(
  execFileImpl: DiagnosticsExecFile,
): Promise<{ processes: CodexRuntimeProcessDiagnostics[]; error?: string }> {
  return new Promise((resolve) => {
    execFileImpl("ps", ["-axo", "pid=,lstart=,command="], {
      timeout: 3000,
      env: {
        ...process.env,
        LANG: "C",
        LC_ALL: "C",
      },
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          processes: [],
          error: truncateDiagnosticError(firstLine(stderr) || firstLine(stdout) || error.message),
        })
        return
      }

      resolve({ processes: parseCodexProcessList(String(stdout)) })
    })
  })
}

function collectWindowsCodexProcesses(
  execFileImpl: DiagnosticsExecFile,
): Promise<{ processes: CodexRuntimeProcessDiagnostics[]; error?: string }> {
  return new Promise((resolve) => {
    execFileImpl("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        "$ErrorActionPreference = 'Stop'",
        "$items = Get-CimInstance Win32_Process | Where-Object {",
        "  ($_.Name -match '(?i)codex') -or ($_.ExecutablePath -match '(?i)codex') -or ($_.CommandLine -match '(?i)codex')",
        "} | ForEach-Object {",
        "  $startedAt = $null",
        "  $command = $_.CommandLine",
        "  if (-not $command) { $command = $_.ExecutablePath }",
        "  if (-not $command) { $command = $_.Name }",
        "  if ($_.CreationDate) { $startedAt = [Management.ManagementDateTimeConverter]::ToDateTime($_.CreationDate).ToUniversalTime().ToString('o') }",
        "  [pscustomobject]@{ pid = $_.ProcessId; command = $command; startedAt = $startedAt }",
        "}",
        "$items | ConvertTo-Json -Compress",
      ].join("; "),
    ], {
      timeout: 3000,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          processes: [],
          error: truncateDiagnosticError(firstLine(stderr) || firstLine(stdout) || error.message),
        })
        return
      }

      try {
        resolve({ processes: parseWindowsCodexProcessList(String(stdout)) })
      } catch (parseError) {
        resolve({
          processes: [],
          error: truncateDiagnosticError(errorLogMessage(parseError, "Codex process list parse failed")),
        })
      }
    })
  })
}

function parseCodexProcessList(stdout: string): CodexRuntimeProcessDiagnostics[] {
  const processes: CodexRuntimeProcessDiagnostics[] = []

  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || !isCodexProcessLine(line)) continue

    const match = /^(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/u.exec(line)
    if (!match) continue

    const startedAtText = match[2]
    const startedAtMs = Date.parse(startedAtText)
    processes.push({
      pid: Number(match[1]),
      command: sanitizeCodexProcessCommand(match[3]),
      startedAtText,
      ...(Number.isFinite(startedAtMs)
        ? { startedAt: new Date(startedAtMs).toISOString(), startedAtMs }
        : {}),
    })
  }

  return processes
}

function parseWindowsCodexProcessList(stdout: string): CodexRuntimeProcessDiagnostics[] {
  const text = stdout.trim()
  if (!text) return []

  const parsed = JSON.parse(text) as unknown
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  const processes: CodexRuntimeProcessDiagnostics[] = []

  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const record = row as Record<string, unknown>
    const pid = Number(record.pid ?? record.ProcessId)
    const command = stringOrNull(record.command ?? record.CommandLine ?? record.ExecutablePath ?? record.Name)
    if (!Number.isFinite(pid) || !command || !isCodexProcessLine(command)) continue

    const startedAtText = stringOrNull(record.startedAt ?? record.CreationDate) ?? undefined
    const startedAtMs = startedAtText ? parseWindowsProcessStartedAtMs(startedAtText) : undefined
    processes.push({
      pid,
      command: sanitizeCodexProcessCommand(command),
      ...(startedAtText ? { startedAtText } : {}),
      ...(startedAtMs !== undefined
        ? { startedAt: new Date(startedAtMs).toISOString(), startedAtMs }
        : {}),
    })
  }

  return processes
}

function sanitizeCodexProcessCommand(command: string): string {
  const redacted = redactSensitiveText(command).trim()
  const executable = extractCodexProcessExecutable(redacted)
  if (!executable) return "codex [args redacted]"

  const suffix = redacted.slice(executable.endIndex).trim()
  return suffix ? `${executable.label} [args redacted]` : executable.label
}

function extractCodexProcessExecutable(command: string): { label: string; endIndex: number } | null {
  const quoted = /^"([^"]*\bcodex(?:\.(?:exe|cmd|bat))?)"(?=\s|$)/iu.exec(command)
  if (quoted?.[1]) {
    return {
      label: quoted[1],
      endIndex: quoted[0].length,
    }
  }

  const appPath = /\/Applications\/Codex\.app\/Contents\/MacOS\/Codex(?=\s|$)/iu.exec(command)
  if (appPath) {
    return {
      label: appPath[0],
      endIndex: appPath.index + appPath[0].length,
    }
  }

  const pathExecutable = /^[^\r\n]*?\bcodex(?:\.(?:exe|cmd|bat))?(?=\s|$)/iu.exec(command)
  if (pathExecutable) {
    return {
      label: pathExecutable[0],
      endIndex: pathExecutable[0].length,
    }
  }

  const token = /\bcodex(?:\.(?:exe|cmd|bat))?(?=\s|$)/iu.exec(command)
  if (!token) return null

  return {
    label: token[0],
    endIndex: token.index + token[0].length,
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function parseWindowsProcessStartedAtMs(value: string): number | undefined {
  const timestamp = Date.parse(value)
  if (Number.isFinite(timestamp)) return timestamp

  const dmtf = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{1,6}))?([+-]\d{3})?$/u.exec(value)
  if (!dmtf) return undefined

  const milliseconds = Number((dmtf[7] ?? "0").padEnd(3, "0").slice(0, 3))
  const localTimeMs = Date.UTC(
    Number(dmtf[1]),
    Number(dmtf[2]) - 1,
    Number(dmtf[3]),
    Number(dmtf[4]),
    Number(dmtf[5]),
    Number(dmtf[6]),
    milliseconds,
  )
  const offsetMinutes = dmtf[8] ? Number(dmtf[8]) : 0
  return localTimeMs - offsetMinutes * 60_000
}

function isCodexProcessLine(line: string): boolean {
  return line.includes("/Applications/Codex.app/")
    || /\bcodex(?:\.(?:exe|cmd|bat)|\s+app-server|\s+exec|\s|$)/i.test(line)
}

function firstLine(value: string | Buffer | undefined): string {
  return String(value ?? "").split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? ""
}

function truncateDiagnosticError(value: string): string {
  return value.length > 240 ? `${value.slice(0, 237)}...` : value
}

function resolveActiveProject(config: SynapseConfig, projectId?: string) {
  return projectId
    ? config.global.projects.find((item) => item.id === projectId)
    : config.global.projects[0]
}

function createDiagnosticsFolderName(generatedAt: string): string {
  return `synapse-diagnostics-${generatedAt.replace(/[:.]/g, "-")}`
}

function isPathInsideDirectory(targetPath: string, directoryPath: string): boolean {
  const relative = path.relative(path.resolve(directoryPath), path.resolve(targetPath))
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function createEmptyConfig(): SynapseConfig {
  return {
    activeRepoUuid: null,
    repositories: [],
    global: {
      themeMode: "system",
      projects: [],
      quickInputs: [],
      defaultQuickInputsSeededVersion: null,
      favorites: { rule: [], skill: [], prompt: [] },
      recentlyViewed: { rule: [], skill: [], prompt: [] },
      contentSortOrder: "modified-desc",
      variables: [],
      knowledgeBaseStorage: { mode: "default" },
    },
    agent: structuredClone(DEFAULT_AGENT_GLOBAL_CONFIG),
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
      samples.push(redactDiagnosticsLogSample(line))
    }
  }

  return { warningCount, errorCount, samples }
}

function summarizeAgentRuntimeLogSignals(content: string): {
  signalCount: number
  warningCount: number
  errorCount: number
  boundaries: string[]
  components: string[]
  correlation: Record<"conversationId" | "messageId" | "sessionId" | "sdkSessionId" | "taskId" | "runId", number>
  samples: string[]
} {
  const boundaries = new Set<string>()
  const components = new Set<string>()
  const samples: string[] = []
  const correlation = {
    conversationId: 0,
    messageId: 0,
    sessionId: 0,
    sdkSessionId: 0,
    taskId: 0,
    runId: 0,
  }
  let signalCount = 0
  let warningCount = 0
  let errorCount = 0
  let previousLevel: "error" | "warning" | undefined

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || !isAgentRuntimeLogLine(line)) continue

    signalCount += 1
    addAgentBoundaries(line, boundaries)
    countAgentCorrelation(line, correlation)

    const component = parseLogComponent(line)
    if (component) components.add(component)

    const level = parseLogLevel(line) ?? (line.startsWith("{") ? previousLevel : undefined)
    if (level === "error") {
      errorCount += 1
    } else if (level === "warning") {
      warningCount += 1
    }
    previousLevel = level ?? previousLevel

    if (samples.length < AGENT_LOG_SAMPLE_LIMIT) {
      samples.push(sanitizeAgentRuntimeLogSample(line))
    }
  }

  return {
    signalCount,
    warningCount,
    errorCount,
    boundaries: [...boundaries].sort(),
    components: [...components].sort(),
    correlation,
    samples,
  }
}

function isAgentRuntimeLogLine(line: string): boolean {
  return /\b(AgentRuntime|Claude SDK|claude-agent-sdk|sdkSessionId|agentSessionId|conversationId|messageId|taskId|runId)\b/i.test(line)
    || /\b(service\.agent-runtime|side-channel|automation-ingress|Agent action|SDK event)\b/i.test(line)
}

function addAgentBoundaries(line: string, boundaries: Set<string>): void {
  if (/\b(service\.agent-runtime|AgentRuntime|Claude SDK|claude-agent-sdk)\b/i.test(line)) boundaries.add("agent-runtime")
  if (/\b(sdkSessionId|SDK event)\b/i.test(line)) boundaries.add("sdk-session")
  if (/\b(side-channel)\b/i.test(line)) boundaries.add("side-channel")
  if (/\b(automation-ingress)\b/i.test(line)) boundaries.add("automation-ingress")
}

function countAgentCorrelation(
  line: string,
  correlation: Record<"conversationId" | "messageId" | "sessionId" | "sdkSessionId" | "taskId" | "runId", number>,
): void {
  for (const key of Object.keys(correlation) as Array<keyof typeof correlation>) {
    if (new RegExp(`\\b${key}\\b`).test(line)) correlation[key] += 1
  }
}

function parseLogLevel(line: string): "error" | "warning" | undefined {
  if (/\[ERROR\s*\]/.test(line) || /\b(error|exception|uncaught|unhandled)\b/i.test(line)) return "error"
  if (/\[WARN\s*\]/.test(line) || /\b(warn|warning|timeout|failed|denied)\b/i.test(line)) return "warning"
  return undefined
}

function parseLogComponent(line: string): string | undefined {
  return /^\[[^\]]+]\s+\[[^\]]+]\s+\[(?<component>[^\]]+)]/.exec(line)?.groups?.component
}

function sanitizeAgentRuntimeLogSample(line: string): string {
  if (line.startsWith("{")) {
    const fields = ["conversationId", "messageId", "sessionId", "sdkSessionId", "taskId", "runId"]
      .filter((key) => new RegExp(`\\b${key}\\b`).test(line))
    return fields.length > 0
      ? `[details redacted] fields=${fields.join(",")}`
      : "[details redacted]"
  }

  const sample = line
    .replace(
      /\b(prompt|message|content|authorization|token|secret|apiKey|cookie|password|credential)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^,\]}]+)/gi,
      "$1=[redacted]",
    )
  return sample.length > 240 ? `${sample.slice(0, 240)}...` : sample
}

function redactDiagnosticsLogContent(content: string): string {
  return content
    .split(/(\r?\n)/)
    .map((segment) => segment.includes("\n") ? segment : redactDiagnosticsLogLine(segment))
    .join("")
}

function selectDiagnosticsLogFilesForExport(
  logFiles: Array<{ name: string; sizeBytes: number }>,
): {
  readonly selected: Array<{ name: string; sizeBytes: number }>
  readonly skipped: Array<{ path: string; reason: string }>
} {
  const selected: Array<{ name: string; sizeBytes: number }> = []
  const skipped: Array<{ path: string; reason: string }> = []
  let includedBytes = 0

  for (const file of logFiles) {
    const relativePath = `logs/${path.basename(file.name)}`
    const sizeBytes = Math.max(0, file.sizeBytes)
    if (selected.length >= DIAGNOSTICS_LOG_EXPORT_MAX_FILES) {
      skipped.push({
        path: relativePath,
        reason: `超过诊断包日志数量上限 ${DIAGNOSTICS_LOG_EXPORT_MAX_FILES} 个。`,
      })
      continue
    }
    if (sizeBytes > DIAGNOSTICS_LOG_EXPORT_MAX_BYTES) {
      skipped.push({
        path: relativePath,
        reason: `超过诊断包单次日志导出大小上限 ${DIAGNOSTICS_LOG_EXPORT_MAX_BYTES} 字节。`,
      })
      continue
    }
    if (includedBytes + sizeBytes > DIAGNOSTICS_LOG_EXPORT_MAX_BYTES) {
      skipped.push({
        path: relativePath,
        reason: `超过诊断包日志总大小上限 ${DIAGNOSTICS_LOG_EXPORT_MAX_BYTES} 字节。`,
      })
      continue
    }
    selected.push(file)
    includedBytes += sizeBytes
  }

  return { selected, skipped }
}

function redactDiagnosticsLogLine(line: string): string {
  return redactSensitiveText(line.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeUrl(url)))
}

function redactDiagnosticsLogSample(line: string): string {
  const redacted = redactDiagnosticsLogLine(line)
  return redacted.length > 300 ? `${redacted.slice(0, 300)}...` : redacted
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
    samples.push(redactDiagnosticsLogSample(line))
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

export {
  collectCodexProcesses,
  DiagnosticsService,
  createDiagnosticsFolderName,
  summarizeDiagnosticsChecks,
  summarizeLogSignals,
  summarizeServiceLifecycle,
}
export type { DiagnosticsServiceDeps }
