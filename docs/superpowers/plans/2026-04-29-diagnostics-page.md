# Diagnostics Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual Diagnostics page in Settings that runs safe local probes, shows grouped conclusions, opens raw JSON in a dialog, and exports one ZIP package with report, logs, config backup, and Data Store database.

**Architecture:** Renderer owns only presentation and user-triggered actions. Electron main owns report collection, safe probes, bundle creation, permissions, and audit. A new `core.diagnostics` service is wired through `ServiceRegistry`, while `ops` IPC remains a thin bridge.

**Tech Stack:** Electron main process, React 19, TypeScript, zod, Vitest, shadcn/ui, Tailwind token utilities, existing IPC codegen.

---

## File Structure

Create:

- `desktop/src/types/diagnostics.ts` — shared diagnostics report/result types.
- `desktop/electron/runtime/archive/index.ts` — shared platform ZIP helper extracted from log export.
- `desktop/electron/services/diagnostics-service.ts` — main-process diagnostics collector and bundle exporter.
- `desktop/electron/services/__tests__/diagnostics-service.test.ts` — service unit tests.
- `desktop/electron/modules/ops/status.ts` — reusable lightweight ops status collector.
- `desktop/electron/modules/ops/__tests__/ipc.test.ts` — ops IPC tests for new methods.
- `desktop/src/modules/settings/components/diagnostics-panel.tsx` — Settings diagnostics UI.
- `desktop/src/modules/settings/components/__tests__/diagnostics-panel.test.tsx` — renderer tests.

Modify:

- `desktop/electron/services/log-store.ts` — use shared ZIP helper and keep log export behavior.
- `desktop/electron/services/config-backup-service.ts` — export pure `createConfigBackupPayload()`.
- `desktop/electron/bootstrap/descriptors.ts` — add `coreDiagnosticsDescriptor`.
- `desktop/electron/bootstrap/registry.ts` — register diagnostics service.
- `desktop/electron/modules/ops/ipc.ts` — use status helper and add diagnostics run/export methods.
- `desktop/electron/generated/ipc-channels.generated.ts` — regenerated.
- `desktop/electron/preload.ts` — expose new ops methods.
- `desktop/src/types/bridge.ts` — import diagnostics types and add bridge methods.
- `desktop/src/modules/settings/types.ts` — add `diagnostics` category id.
- `desktop/src/modules/settings/data.ts` — add sidebar category.
- `desktop/src/modules/settings/index.tsx` — render `DiagnosticsPanel`.

---

### Task 1: Shared Diagnostics Types

**Files:**
- Create: `desktop/src/types/diagnostics.ts`
- Test: `pnpm desktop:typecheck`

- [ ] **Step 1: Create shared report types**

Create `desktop/src/types/diagnostics.ts`:

```ts
type SynapseDiagnosticsStatus = "ok" | "degraded" | "failed" | "skipped"

type SynapseDiagnosticsSeverity = "info" | "warning" | "error"

type SynapseDiagnosticsCheck = {
  id: string
  group: string
  name: string
  status: SynapseDiagnosticsStatus
  severity: SynapseDiagnosticsSeverity
  message: string
  details?: Record<string, unknown>
  durationMs?: number
}

type SynapseDiagnosticsReport = {
  schemaVersion: 1
  generatedAt: string
  overallStatus: Exclude<SynapseDiagnosticsStatus, "skipped">
  summary: {
    ok: number
    degraded: number
    failed: number
    skipped: number
  }
  system: Record<string, unknown>
  app: Record<string, unknown>
  activeContext: {
    repositoryUuid?: string
    repositoryName?: string
    projectId?: string
    projectName?: string
  }
  checks: SynapseDiagnosticsCheck[]
  bundle?: {
    lastExportedAt?: string
    lastExportPath?: string
  }
}

type SynapseDiagnosticsBundleExportResult = {
  success: boolean
  filePath?: string
  fileCount?: number
}

export type {
  SynapseDiagnosticsBundleExportResult,
  SynapseDiagnosticsCheck,
  SynapseDiagnosticsReport,
  SynapseDiagnosticsSeverity,
  SynapseDiagnosticsStatus,
}
```

- [ ] **Step 2: Run typecheck for the new type file**

Run:

```bash
pnpm desktop:typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/types/diagnostics.ts
git commit -m "feat: add diagnostics shared types"
```

---

### Task 2: Extract ZIP Helper and Config Backup Payload

**Files:**
- Create: `desktop/electron/runtime/archive/index.ts`
- Modify: `desktop/electron/services/log-store.ts`
- Modify: `desktop/electron/services/config-backup-service.ts`
- Test: existing log/config tests through `pnpm desktop:test`

- [ ] **Step 1: Create shared ZIP helper**

Create `desktop/electron/runtime/archive/index.ts`:

```ts
import { spawn } from "node:child_process"
import path from "node:path"

function escapePowerShellSingleQuotedString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function formatArchiveSpawnError(error: unknown): string {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return "当前系统缺少导出压缩包所需的工具。"
  }

  return error instanceof Error ? error.message : "启动压缩命令失败。"
}

function formatArchiveFailureMessage(output: string): string {
  const fallbackMessage = "创建压缩包失败，请稍后重试。"
  const firstLine = output
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  return firstLine ? `${fallbackMessage}\n${firstLine}` : fallbackMessage
}

function runArchiveCommand(
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      cwd: options?.cwd,
      env: { ...process.env },
    })

    let stdout = ""
    let stderr = ""

    childProcess.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })

    childProcess.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })

    childProcess.on("error", (error) => {
      reject(new Error(formatArchiveSpawnError(error)))
    })

    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(formatArchiveFailureMessage(`${stdout}\n${stderr}`)))
    })
  })
}

async function createZipArchive(sourceDirectoryPath: string, outputFilePath: string): Promise<void> {
  if (process.platform === "win32") {
    const script = [
      "Compress-Archive",
      "-LiteralPath",
      escapePowerShellSingleQuotedString(sourceDirectoryPath),
      "-DestinationPath",
      escapePowerShellSingleQuotedString(outputFilePath),
      "-CompressionLevel",
      "Optimal",
      "-Force",
    ].join(" ")

    await runArchiveCommand("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ])
    return
  }

  if (process.platform === "darwin") {
    await runArchiveCommand("ditto", [
      "-c",
      "-k",
      "--keepParent",
      sourceDirectoryPath,
      outputFilePath,
    ])
    return
  }

  await runArchiveCommand(
    "zip",
    ["-r", "-q", outputFilePath, path.basename(sourceDirectoryPath)],
    { cwd: path.dirname(sourceDirectoryPath) },
  )
}

export { createZipArchive }
```

- [ ] **Step 2: Replace the local log-store archive helper**

In `desktop/electron/services/log-store.ts`, add:

```ts
import { createZipArchive } from "../runtime/archive"
```

Then remove the local `escapePowerShellSingleQuotedString`, `formatArchiveSpawnError`, `formatArchiveFailureMessage`, `runArchiveCommand`, and `createZipArchive` functions from `log-store.ts`. Also remove unused imports:

```ts
import { spawn } from "node:child_process"
```

Keep `exportAllLogs()` calling `createZipArchive(stagingDirectoryPath, exportFilePath)`.

- [ ] **Step 3: Extract config backup payload helper**

In `desktop/electron/services/config-backup-service.ts`, add this function above `writeBackupFile()`:

```ts
async function createConfigBackupPayload(): Promise<SynapseConfigBackup> {
  const config = await configStore.load()
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    config: {
      ...config,
      repositories: config.repositories.map((repository) => ({
        uuid: repository.uuid,
        name: repository.name,
        localPath: repository.localPath,
        contentDirs: repository.contentDirs,
      })),
    },
    identity: await userIdentityService.exportIdentity(),
  }
}
```

- [ ] **Step 4: Reuse the helper in exportBackup**

Replace the inline `backup` construction in `ConfigBackupService.exportBackup()` with:

```ts
    const backup = await createConfigBackupPayload()
```

- [ ] **Step 5: Export the helper**

Change the final export in `desktop/electron/services/config-backup-service.ts` to include:

```ts
export { configBackupService, createConfigBackupPayload }
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm desktop:test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/runtime/archive/index.ts desktop/electron/services/log-store.ts desktop/electron/services/config-backup-service.ts
git commit -m "refactor: share archive and config backup helpers"
```

---

### Task 3: Reusable Ops Status Helper

**Files:**
- Create: `desktop/electron/modules/ops/status.ts`
- Modify: `desktop/electron/modules/ops/ipc.ts`
- Test: `desktop/electron/modules/ops/__tests__/ipc.test.ts`

- [ ] **Step 1: Create ops status helper**

Create `desktop/electron/modules/ops/status.ts`:

```ts
import { app } from "electron"
import { z } from "zod"

import type { ProjectContainerRegistry } from "../../runtime/project-container"
import {
  AgentRuntimeService,
  AGENT_RUNTIME_SERVICE_ID,
} from "../../services/agent-runtime"
import type { AutomationIngressService } from "../../services/automation-ingress"
import type { FeishuConnectorService } from "../../services/connectors"
import { configStore } from "../../services/config-store"
import { logStore } from "../../services/log-store"
import type { AgentRelayService } from "../../services/relay"
import type { SideChannelService } from "../../services/side-channel"

const opsStatusSchema = z.object({
  appVersion: z.string(),
  singleInstanceLocked: z.boolean(),
  logPath: z.string(),
  sideChannel: z.object({
    enabled: z.boolean(),
    bindAddress: z.string().optional(),
    port: z.number().optional(),
    sendPath: z.string(),
    cronAddPath: z.string(),
    relaySendPath: z.string(),
  }).optional(),
  webhook: z.object({
    enabled: z.boolean(),
    bindAddress: z.string(),
    path: z.string(),
    preferredPort: z.number().optional(),
    assignedPort: z.number().optional(),
    maxBodyBytes: z.number(),
    rateLimitPerMinute: z.number(),
    serviceRestartRequired: z.boolean().optional(),
    lastError: z.string().optional(),
  }).optional(),
  relay: z.object({
    bindingCount: z.number(),
    recentRunCount: z.number(),
  }).optional(),
  agent: z.object({
    projectId: z.string(),
    agentType: z.string(),
    liveSessions: z.number(),
    busySessions: z.number(),
    queuedTurns: z.number(),
    pendingPermissions: z.number(),
  }).optional(),
  feishu: z.object({
    projectId: z.string(),
    configured: z.boolean(),
    running: z.boolean(),
  }).optional(),
})

type OpsStatus = z.infer<typeof opsStatusSchema>

type ServiceResolver = <T>(serviceId: string) => T

async function collectOpsStatus(
  resolve: ServiceResolver,
  projectId?: string,
): Promise<OpsStatus> {
  const resolvedProjectId = projectId ?? await firstProjectId()
  return {
    appVersion: app.getVersion(),
    singleInstanceLocked: app.hasSingleInstanceLock(),
    logPath: logStore.getLogDirectory(),
    sideChannel: optional<SideChannelService>(resolve, "core.side-channel")?.getStatus(),
    webhook: await optional<AutomationIngressService>(resolve, "core.automation-ingress")?.getStatus(),
    relay: await relayStatus(optional<AgentRelayService>(resolve, "core.relay")),
    agent: resolvedProjectId ? await agentStatus(resolve, resolvedProjectId) : undefined,
    feishu: resolvedProjectId ? await feishuStatus(resolve, resolvedProjectId) : undefined,
  }
}

async function firstProjectId(): Promise<string | undefined> {
  const config = await configStore.load()
  return config.global.projects[0]?.id
}

async function projectById(projectId: string) {
  const config = await configStore.load()
  return config.global.projects.find((item) => item.id === projectId)
}

async function agentStatus(resolve: ServiceResolver, projectId: string) {
  const containers = resolve<ProjectContainerRegistry>("core.project-containers")
  const project = await projectById(projectId)
  if (!project) return undefined
  const container = await containers.open(project.id, {
    name: project.name,
    workspacePath: project.path,
  })
  return container.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID).getStatus()
}

async function feishuStatus(resolve: ServiceResolver, projectId: string) {
  const service = optional<FeishuConnectorService>(resolve, "core.feishu-connector")
  if (!service) return undefined
  const status = await service.getStatus(projectId)
  return {
    projectId: status.projectId,
    configured: status.configured,
    running: status.running,
  }
}

async function relayStatus(service: AgentRelayService | undefined) {
  if (!service) return undefined
  const bindings = await service.listBindings()
  const runs = await service.listRuns()
  return {
    bindingCount: bindings.length,
    recentRunCount: runs.length,
  }
}

function optional<T>(resolve: ServiceResolver, serviceId: string): T | undefined {
  try {
    return resolve<T>(serviceId)
  } catch {
    return undefined
  }
}

export { collectOpsStatus, opsStatusSchema }
export type { OpsStatus, ServiceResolver }
```

- [ ] **Step 2: Use the helper in ops IPC**

In `desktop/electron/modules/ops/ipc.ts`, remove direct imports now owned by `status.ts`:

```ts
import { app, shell } from "electron"
import {
  AgentRuntimeService,
  AGENT_RUNTIME_SERVICE_ID,
} from "../../services/agent-runtime"
import type { FeishuConnectorService } from "../../services/connectors"
import { logStore } from "../../services/log-store"
import type { AgentRelayService } from "../../services/relay"
import type { SideChannelService } from "../../services/side-channel"
```

Replace with:

```ts
import { shell } from "electron"
import { collectOpsStatus, opsStatusSchema } from "./status"
```

Keep imports used by run-as/webhook/relay/compress methods.

- [ ] **Step 3: Replace the status schema**

Remove the local `statusSchema` constant from `ops/ipc.ts`. In the `diagnostics` method descriptor, set:

```ts
      response: opsStatusSchema,
      handler: async (ctx, request: DiagnosticsRequest) =>
        collectOpsStatus(ctx.resolve, request.projectId),
```

- [ ] **Step 4: Remove moved helper functions**

Delete from `ops/ipc.ts`:

```ts
firstProjectId
agentStatus
feishuStatus
relayStatus
optional
```

Keep `projectById`, `resolveProjectAgent`, `resolveRunAs`, `resolveWebhook`, and `resolveRelay`, because later ops methods still use them.

- [ ] **Step 5: Add ops IPC regression test**

Create `desktop/electron/modules/ops/__tests__/ipc.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"
import type { IpcHandlerContext } from "../../../runtime/ipc"
import { configStore } from "../../../services/config-store"
import { logStore } from "../../../services/log-store"
import { opsIpcModule } from "../ipc"

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.2.49",
    hasSingleInstanceLock: () => true,
  },
  shell: {
    openPath: vi.fn(),
  },
}))

vi.mock("../../../services/config-store", () => ({
  configStore: {
    load: vi.fn(),
  },
}))

vi.mock("../../../services/log-store", () => ({
  logStore: {
    getLogDirectory: vi.fn(() => "/tmp/synapse/logs"),
  },
}))

describe("opsIpcModule", () => {
  beforeEach(() => {
    vi.mocked(configStore.load).mockResolvedValue({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "system",
        projects: [],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
    } as never)
  })

  it("returns lightweight diagnostics through the shared status helper", async () => {
    const harness = createHarness()

    const result = await harness.invoke("synapse:ops:diagnostics", {})

    expect(result).toMatchObject({
      appVersion: "0.2.49",
      singleInstanceLocked: true,
      logPath: "/tmp/synapse/logs",
    })
    expect(logStore.getLogDirectory).toHaveBeenCalled()
  })
})

function createHarness() {
  const harness = createInMemoryHarness()
  const resolve: IpcHandlerContext["resolve"] = <T,>(_serviceId: string): T => {
    throw new Error("service not registered")
  }
  harness.registry.register(opsIpcModule, { moduleId: "ops", resolve })
  return harness
}
```

- [ ] **Step 6: Run the focused IPC test**

Run:

```bash
pnpm desktop:test -- desktop/electron/modules/ops/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/modules/ops/status.ts desktop/electron/modules/ops/ipc.ts desktop/electron/modules/ops/__tests__/ipc.test.ts
git commit -m "refactor: share ops diagnostics status"
```

---

### Task 4: Diagnostics Service Report Collection

**Files:**
- Create: `desktop/electron/services/diagnostics-service.ts`
- Create/Modify: `desktop/electron/services/__tests__/diagnostics-service.test.ts`

- [ ] **Step 1: Write failing tests for status aggregation and safe probe wrapping**

Create `desktop/electron/services/__tests__/diagnostics-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import {
  DiagnosticsService,
  summarizeDiagnosticsChecks,
} from "../diagnostics-service"
import type { SynapseDiagnosticsCheck } from "../../../src/types/diagnostics"

describe("summarizeDiagnosticsChecks", () => {
  it("marks a report failed when any check fails", () => {
    const checks: SynapseDiagnosticsCheck[] = [
      {
        id: "system.ok",
        group: "系统",
        name: "系统",
        status: "ok",
        severity: "info",
        message: "通过",
      },
      {
        id: "path.project",
        group: "路径与权限",
        name: "项目路径",
        status: "failed",
        severity: "error",
        message: "路径不可访问",
      },
    ]

    expect(summarizeDiagnosticsChecks(checks)).toEqual({
      overallStatus: "failed",
      summary: {
        ok: 1,
        degraded: 0,
        failed: 1,
        skipped: 0,
      },
    })
  })

  it("marks a report degraded when warnings exist without failures", () => {
    const checks: SynapseDiagnosticsCheck[] = [{
      id: "data-store.cli",
      group: "Data Store",
      name: "CLI",
      status: "degraded",
      severity: "warning",
      message: "CLI 不可用",
    }]

    expect(summarizeDiagnosticsChecks(checks).overallStatus).toBe("degraded")
  })
})

describe("DiagnosticsService.collect", () => {
  it("returns a report even when a probe throws", async () => {
    const service = createService({
      statPath: vi.fn(async (targetPath: string) => {
        if (targetPath === "/missing-project") {
          throw new Error("ENOENT")
        }
        return { isDirectory: () => true }
      }),
    })

    const report = await service.collect()

    expect(report.schemaVersion).toBe(1)
    expect(report.overallStatus).toBe("failed")
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "project.path.project-1",
          status: "failed",
          message: "ENOENT",
        }),
      ]),
    )
  })
})

function createService(overrides: Partial<ConstructorParameters<typeof DiagnosticsService>[0]> = {}) {
  return new DiagnosticsService({
    appInfo: {
      getVersion: () => "0.2.49",
      hasSingleInstanceLock: () => true,
      isPackaged: false,
      getPath: (name) => `/app/${name}`,
    },
    configStore: {
      load: vi.fn(async () => ({
        activeRepoUuid: "repo-1",
        repositories: [{
          uuid: "repo-1",
          name: "Repo",
          localPath: "/repo",
          contentDirs: {},
        }],
        global: {
          themeMode: "system",
          projects: [{ id: "project-1", name: "Project", path: "/missing-project" }],
          favorites: { rule: [], skill: [], prompt: [] },
          recentlyViewed: { rule: [], skill: [], prompt: [] },
          contentSortOrder: "modified-desc",
        },
      })),
    },
    dataRepository: {
      inspect: () => [],
    },
    serviceRegistry: {
      inspect: () => [],
      get: vi.fn((serviceId: string) => {
        throw new Error(`service not registered: ${serviceId}`)
      }),
    },
    logStore: {
      getLogDirectory: () => "/logs",
      listLogFilesInfo: vi.fn(async () => []),
      flush: vi.fn(async () => undefined),
    },
    dataStore: {
      getDbPath: () => "/data/synapse-data.db",
      getDbSize: () => 0,
      getTableCount: () => 0,
      exportDatabase: vi.fn(),
    },
    getDataStoreRuntimeStatus: vi.fn(() => ({
      running: true,
      port: 19731,
      dbDirectoryPath: "/data",
    })),
    collectOpsStatus: vi.fn(async () => ({
      appVersion: "0.2.49",
      singleInstanceLocked: true,
      logPath: "/logs",
    })),
    getCliDebugInfo: vi.fn(async () => ({ status: { available: true } })),
    getMcpHttpStatus: vi.fn(() => ({ running: false, port: 0, url: "" })),
    getMcpServers: vi.fn(() => []),
    permissionGuard: {
      check: vi.fn(async () => ({ allowed: true as const })),
      registerPolicy: vi.fn(),
    },
    auditSink: {
      record: vi.fn(),
      list: () => [],
      clearForTests: vi.fn(),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    },
    now: () => new Date("2026-04-29T03:31:20.000Z"),
    platformInfo: () => ({
      platform: "darwin",
      arch: "arm64",
      release: "25.0.0",
      node: "v25.6.0",
      chrome: "143.0.0",
      electron: "41.2.1",
      pid: 123,
    }),
    statPath: vi.fn(async () => ({ isDirectory: () => true })),
    writeReadDeleteProbe: vi.fn(async () => undefined),
    ...overrides,
  })
}
```

The test references `DiagnosticsService`, so it should fail before implementation.

- [ ] **Step 2: Run the failing diagnostics-service test**

Run:

```bash
pnpm desktop:test -- desktop/electron/services/__tests__/diagnostics-service.test.ts
```

Expected: FAIL with missing `diagnostics-service` module or missing exports.

- [ ] **Step 3: Implement report collection service**

Create `desktop/electron/services/diagnostics-service.ts`:

```ts
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type {
  SynapseDiagnosticsCheck,
  SynapseDiagnosticsReport,
} from "../../src/types/diagnostics"
import type { SynapseConfig } from "../../src/types/config"
import type { DataRepository } from "../runtime/data-repo"
import type { ServiceRegistry } from "../runtime/service-registry"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import type { StructuredLogger } from "../runtime/logging"
import type { OpsStatus, ServiceResolver } from "../modules/ops/status"
import type { DataStoreCliDebugInfo, DataStoreMcpHttpStatus, DataStoreMcpServerInfo } from "../../src/types/data-store"

type AppInfo = {
  getVersion(): string
  hasSingleInstanceLock(): boolean
  isPackaged: boolean
  getPath(name: string): string
}

type PlatformInfo = {
  platform: string
  arch: string
  release: string
  node: string
  chrome?: string
  electron?: string
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

type DataStoreRuntimeStatus = {
  running: boolean
  port: number
  dbDirectoryPath: string
}

type DiagnosticsServiceDeps = {
  appInfo: AppInfo
  configStore: ConfigStoreLike
  dataRepository: Pick<DataRepository, "inspect">
  serviceRegistry: Pick<ServiceRegistry, "get" | "inspect">
  logStore: LogStoreLike
  dataStore: DataStoreLike
  getDataStoreRuntimeStatus: () => DataStoreRuntimeStatus
  collectOpsStatus: (resolve: ServiceResolver, projectId?: string) => Promise<OpsStatus>
  getCliDebugInfo: () => Promise<Partial<DataStoreCliDebugInfo>>
  getMcpHttpStatus: () => DataStoreMcpHttpStatus
  getMcpServers: () => Promise<DataStoreMcpServerInfo[]>
  permissionGuard: PermissionGuard
  auditSink: AuditSink
  logger: StructuredLogger
  now?: () => Date
  platformInfo?: () => PlatformInfo
  statPath?: (targetPath: string) => Promise<PathStats>
  writeReadDeleteProbe?: (directoryPath: string) => Promise<void>
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

  constructor(deps: DiagnosticsServiceDeps) {
    this.deps = deps
  }

  async collect(payload: { projectId?: string } = {}): Promise<SynapseDiagnosticsReport> {
    const generatedAt = this.now().toISOString()
    const config = await this.deps.configStore.load()
    const activeProject = resolveActiveProject(config, payload.projectId)
    const activeRepository = config.repositories.find((item) => item.uuid === config.activeRepoUuid)
    const checks: SynapseDiagnosticsCheck[] = []

    checks.push(this.ok("system.process", "系统", "进程", "系统信息已读取", this.platformInfo()))
    checks.push(this.ok("app.version", "应用", "版本", this.deps.appInfo.getVersion(), {
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
        version: this.deps.appInfo.getVersion(),
        isPackaged: this.deps.appInfo.isPackaged,
        singleInstanceLocked: this.deps.appInfo.hasSingleInstanceLock(),
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
    }
  }

  private async addPathChecks(checks: SynapseDiagnosticsCheck[], config: SynapseConfig): Promise<void> {
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
    const runtimeStatus = this.deps.getDataStoreRuntimeStatus()
    checks.push(this.ok("data-store.status", "Data Store", "数据库", "数据库状态已读取", {
      running: runtimeStatus.running,
      port: runtimeStatus.port,
      dbDirectoryPath: runtimeStatus.dbDirectoryPath,
      dbPath: this.deps.dataStore.getDbPath(),
      dbSize: this.deps.dataStore.getDbSize(),
      tableCount: this.deps.dataStore.getTableCount(),
    }))

    await this.capture(checks, "data-store.cli", "Data Store", "CLI", async () => {
      const debugInfo = await this.deps.getCliDebugInfo()
      const available = Boolean(debugInfo.status?.available)
      return available
        ? this.ok("data-store.cli", "Data Store", "CLI", "CLI 可用", debugInfo)
        : this.degraded("data-store.cli", "Data Store", "CLI", "CLI 不可用", debugInfo)
    })

    await this.capture(checks, "data-store.mcp", "Data Store", "MCP", async () => {
      const http = this.deps.getMcpHttpStatus()
      const registrations = await this.deps.getMcpServers()
      return this.ok("data-store.mcp", "Data Store", "MCP", "MCP 状态已读取", {
        http,
        registrations,
      })
    })
  }

  private async addInspectChecks(checks: SynapseDiagnosticsCheck[]): Promise<void> {
    checks.push(this.ok("services.inspect", "服务", "服务注册表", "服务信息已读取", {
      services: this.deps.serviceRegistry.inspect(),
    }))
    checks.push(this.ok("data-repo.inspect", "服务", "DataRepository", "数据仓库信息已读取", {
      namespaces: this.deps.dataRepository.inspect(),
    }))
  }

  private async addOpsChecks(checks: SynapseDiagnosticsCheck[], projectId?: string): Promise<void> {
    await this.capture(checks, "ops.status", "连接器", "运行状态", async () => {
      const status = await this.deps.collectOpsStatus((serviceId) => this.deps.serviceRegistry.get(serviceId), projectId)
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

  private ok(id: string, group: string, name: string, message: string, details?: Record<string, unknown>): SynapseDiagnosticsCheck {
    return { id, group, name, status: "ok", severity: "info", message, details }
  }

  private degraded(id: string, group: string, name: string, message: string, details?: Record<string, unknown>): SynapseDiagnosticsCheck {
    return { id, group, name, status: "degraded", severity: "warning", message, details }
  }

  private statPath(targetPath: string): Promise<PathStats> {
    return (this.deps.statPath ?? stat)(targetPath)
  }

  private writeReadDeleteProbe(directoryPath: string): Promise<void> {
    return (this.deps.writeReadDeleteProbe ?? writeReadDeleteProbe)(directoryPath)
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private platformInfo(): PlatformInfo {
    return this.deps.platformInfo?.() ?? {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      node: process.version,
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      pid: process.pid,
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

export {
  DiagnosticsService,
  summarizeDiagnosticsChecks,
}
export type { DiagnosticsServiceDeps }
```

- [ ] **Step 4: Run typecheck for the service**

Run:

```bash
pnpm desktop:typecheck
```

Expected: PASS for the diagnostics service types.

- [ ] **Step 5: Run diagnostics-service tests**

Run:

```bash
pnpm desktop:test -- desktop/electron/services/__tests__/diagnostics-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/diagnostics-service.ts desktop/electron/services/__tests__/diagnostics-service.test.ts
git commit -m "feat: collect diagnostics report"
```

---

### Task 5: Diagnostics Bundle Export

**Files:**
- Modify: `desktop/electron/services/diagnostics-service.ts`
- Modify: `desktop/electron/services/__tests__/diagnostics-service.test.ts`

- [ ] **Step 1: Add failing bundle export test**

Append to `desktop/electron/services/__tests__/diagnostics-service.test.ts`:

```ts
describe("DiagnosticsService.exportBundle", () => {
  it("writes diagnostics package files and records allowed export", async () => {
    const writtenFiles = new Map<string, string>()
    const auditSink = {
      record: vi.fn(),
      list: () => [],
      clearForTests: vi.fn(),
    }
    const service = createService({
      auditSink,
      chooseSavePath: vi.fn(async () => "/downloads/synapse-diagnostics.zip"),
      makeTempDir: vi.fn(async () => "/tmp/synapse-diagnostics-test"),
      writeTextFile: vi.fn(async (targetPath: string, content: string) => {
        writtenFiles.set(targetPath, content)
      }),
      copyFile: vi.fn(async () => undefined),
      createZipArchive: vi.fn(async () => undefined),
      removePath: vi.fn(async () => undefined),
      createConfigBackupPayload: vi.fn(async () => ({
        schemaVersion: 1,
        exportedAt: "2026-04-29T03:31:20.000Z",
        config: {
          activeRepoUuid: null,
          repositories: [],
          global: {
            themeMode: "system",
            projects: [],
            favorites: { rule: [], skill: [], prompt: [] },
            recentlyViewed: { rule: [], skill: [], prompt: [] },
            contentSortOrder: "modified-desc",
          },
        },
        identity: {
          schemaVersion: 1,
          userId: "user-1",
          createdAt: "2026-04-29T03:31:20.000Z",
          updatedAt: "2026-04-29T03:31:20.000Z",
        },
      })),
    })
    const report = await service.collect()

    const result = await service.exportBundle({ report })

    expect(result).toEqual({
      success: true,
      filePath: "/downloads/synapse-diagnostics.zip",
      fileCount: expect.any(Number),
    })
    expect(writtenFiles.has("/tmp/synapse-diagnostics-test/synapse-diagnostics-2026-04-29T03-31-20-000Z/diagnostics.json")).toBe(true)
    expect(writtenFiles.has("/tmp/synapse-diagnostics-test/synapse-diagnostics-2026-04-29T03-31-20-000Z/manifest.json")).toBe(true)
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "allowed",
      resource: "/downloads/synapse-diagnostics.zip",
    }))
  })

  it("returns success false when the user cancels save", async () => {
    const service = createService({
      chooseSavePath: vi.fn(async () => null),
    })
    const report = await service.collect()

    await expect(service.exportBundle({ report })).resolves.toEqual({ success: false })
  })
})
```

Update `createService()` defaults with the extra dependencies used by export:

```ts
    chooseSavePath: vi.fn(async () => "/downloads/synapse-diagnostics.zip"),
    makeTempDir: vi.fn(async () => "/tmp/synapse-diagnostics-test"),
    writeTextFile: vi.fn(async () => undefined),
    copyFile: vi.fn(async () => undefined),
    createZipArchive: vi.fn(async () => undefined),
    removePath: vi.fn(async () => undefined),
    createConfigBackupPayload: vi.fn(async () => ({
      schemaVersion: 1,
      exportedAt: "2026-04-29T03:31:20.000Z",
      config: {
        activeRepoUuid: null,
        repositories: [],
        global: {
          themeMode: "system",
          projects: [],
          favorites: { rule: [], skill: [], prompt: [] },
          recentlyViewed: { rule: [], skill: [], prompt: [] },
          contentSortOrder: "modified-desc",
        },
      },
      identity: {
        schemaVersion: 1,
        userId: "user-1",
        createdAt: "2026-04-29T03:31:20.000Z",
        updatedAt: "2026-04-29T03:31:20.000Z",
      },
    })),
```

- [ ] **Step 2: Run the failing bundle tests**

Run:

```bash
pnpm desktop:test -- desktop/electron/services/__tests__/diagnostics-service.test.ts
```

Expected: FAIL because `exportBundle()` and export dependencies do not exist.

- [ ] **Step 3: Add export dependencies to service type**

In `desktop/electron/services/diagnostics-service.ts`, update the fs import:

```ts
import { copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
```

Add the config backup import:

```ts
import { createConfigBackupPayload } from "./config-backup-service"
```

In `DiagnosticsServiceDeps`, add:

```ts
  chooseSavePath?: (defaultFileName: string) => Promise<string | null>
  makeTempDir?: (prefix: string) => Promise<string>
  writeTextFile?: (targetPath: string, content: string) => Promise<void>
  copyFile?: (sourcePath: string, targetPath: string) => Promise<void>
  createZipArchive?: (sourceDirectoryPath: string, outputFilePath: string) => Promise<void>
  removePath?: (targetPath: string) => Promise<void>
  createConfigBackupPayload?: typeof createConfigBackupPayload
```

- [ ] **Step 4: Implement `exportBundle()`**

Add to `DiagnosticsService`:

```ts
  async exportBundle(payload: { report: SynapseDiagnosticsReport }): Promise<{
    success: boolean
    filePath?: string
    fileCount?: number
  }> {
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

    try {
      await mkdir(path.join(packageRoot, "logs"), { recursive: true })
      await mkdir(path.join(packageRoot, "config"), { recursive: true })
      await mkdir(path.join(packageRoot, "data-store"), { recursive: true })

      await this.writeTextFile(
        path.join(packageRoot, "diagnostics.json"),
        `${JSON.stringify(payload.report, null, 2)}\n`,
      )
      included.push("diagnostics.json")

      await this.writeOptionalJsonFile(
        path.join(packageRoot, "config", "config-backup.json"),
        "config/config-backup.json",
        () => this.createConfigBackupPayload(),
        included,
        skipped,
      )

      await this.copyOptionalFile(
        this.deps.dataStore.getDbPath(),
        path.join(packageRoot, "data-store", "synapse-data.db"),
        "data-store/synapse-data.db",
        included,
        skipped,
        () => this.deps.dataStore.exportDatabase(path.join(packageRoot, "data-store", "synapse-data.db")),
      )

      await this.copyLogFiles(packageRoot, included, skipped)

      const manifest = {
        schemaVersion: 1,
        generatedAt: this.now().toISOString(),
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
      await this.removePath(stagingRoot)
    }
  }
```

- [ ] **Step 5: Add export helper methods**

Add these methods inside `DiagnosticsService`:

```ts
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
      const relativePath = `logs/${file.name}`
      await this.copyOptionalFile(
        path.join(logDirectory, file.name),
        path.join(packageRoot, relativePath),
        relativePath,
        included,
        skipped,
      )
    }
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

  private createConfigBackupPayload() {
    return (this.deps.createConfigBackupPayload ?? createConfigBackupPayload)()
  }
```

- [ ] **Step 6: Add folder name helper**

Add below `resolveActiveProject()`:

```ts
function createDiagnosticsFolderName(generatedAt: string): string {
  return `synapse-diagnostics-${generatedAt.replace(/[:.]/g, "-")}`
}
```

Export it for future tests:

```ts
export {
  DiagnosticsService,
  createDiagnosticsFolderName,
  summarizeDiagnosticsChecks,
}
```

- [ ] **Step 7: Run bundle tests**

Run:

```bash
pnpm desktop:test -- desktop/electron/services/__tests__/diagnostics-service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/services/diagnostics-service.ts desktop/electron/services/__tests__/diagnostics-service.test.ts
git commit -m "feat: export diagnostics bundle"
```

---

### Task 6: Bootstrap and IPC Wiring

**Files:**
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/registry.ts`
- Modify: `desktop/electron/modules/ops/ipc.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Test: `desktop/electron/modules/ops/__tests__/ipc.test.ts`

- [ ] **Step 1: Wire diagnostics descriptor**

In `desktop/electron/bootstrap/descriptors.ts`, update the Electron import and add the new imports:

```ts
import { app, dialog, safeStorage } from "electron"
import path from "node:path"
import { DiagnosticsService } from "../services/diagnostics-service"
import { createZipArchive } from "../runtime/archive"
import { collectOpsStatus } from "../modules/ops/status"
import { dataStoreService } from "../data-store/service"
import { getHttpPort } from "../data-store/http-server"
import { getCliDebugInfo } from "../data-store/cli-installer"
import { getMcpServers } from "../data-store/mcp-installer"
import { getMcpServerPort, getMcpServerUrl, isMcpServerRunning } from "../data-store/mcp-server"
import { createConfigBackupPayload } from "../services/config-backup-service"
```

- [ ] **Step 2: Add descriptor**

Add after `coreAuditSinkDescriptor`:

```ts
export const coreDiagnosticsDescriptor: ServiceDescriptor<DiagnosticsService> = {
  id: "core.diagnostics",
  criticality: "degraded",
  dependsOn: [
    "core.config",
    "core.data-store",
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
    "core.project-containers",
  ],
  create(ctx) {
    return new DiagnosticsService({
      appInfo: app,
      configStore,
      dataRepository: ctx.registry.get<DataRepository>("core.data-repository"),
      serviceRegistry: ctx.registry,
      logStore,
      dataStore: dataStoreService,
      getDataStoreRuntimeStatus: () => {
        const dbPath = dataStoreService.getDbPath()
        return {
          running: getHttpPort() > 0,
          port: getHttpPort(),
          dbDirectoryPath: path.dirname(dbPath),
        }
      },
      collectOpsStatus,
      getCliDebugInfo,
      getMcpHttpStatus: () => ({
        running: isMcpServerRunning(),
        port: getMcpServerPort(),
        url: getMcpServerUrl(),
      }),
      getMcpServers,
      permissionGuard: ctx.registry.get<PermissionGuard>("core.permission-guard"),
      auditSink: ctx.registry.get<AuditSink>("core.audit-sink"),
      logger: ctx.logger.child("diagnostics"),
      createZipArchive,
      createConfigBackupPayload,
      chooseSavePath: async (defaultFileName) => {
        const result = await dialog.showSaveDialog({
          defaultPath: `${app.getPath("downloads")}/${defaultFileName}`,
          filters: [{ name: "ZIP", extensions: ["zip"] }],
        })
        return result.canceled || !result.filePath ? null : result.filePath
      },
    })
  },
}
```

- [ ] **Step 3: Register descriptor**

In `desktop/electron/bootstrap/registry.ts`, add `coreDiagnosticsDescriptor` to imports and register it after `coreDataStoreDescriptor`:

```ts
  registry.register(coreDiagnosticsDescriptor)
```

- [ ] **Step 4: Add ops IPC schemas and methods**

In `desktop/electron/modules/ops/ipc.ts`, import:

```ts
import type { DiagnosticsService } from "../../services/diagnostics-service"
```

Add schemas:

```ts
const diagnosticsRunRequestSchema = z.object({
  projectId: z.string().optional(),
})

const diagnosticsReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  overallStatus: z.enum(["ok", "degraded", "failed"]),
  summary: z.object({
    ok: z.number(),
    degraded: z.number(),
    failed: z.number(),
    skipped: z.number(),
  }),
  system: z.record(z.string(), z.unknown()),
  app: z.record(z.string(), z.unknown()),
  activeContext: z.object({
    repositoryUuid: z.string().optional(),
    repositoryName: z.string().optional(),
    projectId: z.string().optional(),
    projectName: z.string().optional(),
  }),
  checks: z.array(z.object({
    id: z.string(),
    group: z.string(),
    name: z.string(),
    status: z.enum(["ok", "degraded", "failed", "skipped"]),
    severity: z.enum(["info", "warning", "error"]),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    durationMs: z.number().optional(),
  })),
  bundle: z.object({
    lastExportedAt: z.string().optional(),
    lastExportPath: z.string().optional(),
  }).optional(),
})

const diagnosticsBundleRequestSchema = z.object({
  report: diagnosticsReportSchema,
})

const diagnosticsBundleResultSchema = z.object({
  success: z.boolean(),
  filePath: z.string().optional(),
  fileCount: z.number().optional(),
})
```

Add methods inside `opsIpcModule.methods`:

```ts
    runDiagnostics: {
      kind: "invoke",
      channel: "synapse:ops:diagnostics:run",
      request: diagnosticsRunRequestSchema,
      response: diagnosticsReportSchema,
      handler: (ctx, request) =>
        ctx.resolve<DiagnosticsService>("core.diagnostics").collect(request),
    },
    exportDiagnosticsBundle: {
      kind: "invoke",
      channel: "synapse:ops:diagnostics:export-bundle",
      request: diagnosticsBundleRequestSchema,
      response: diagnosticsBundleResultSchema,
      handler: (ctx, request) =>
        ctx.resolve<DiagnosticsService>("core.diagnostics").exportBundle(request),
    },
```

- [ ] **Step 5: Add IPC tests**

Append to `desktop/electron/modules/ops/__tests__/ipc.test.ts`:

```ts
  it("runs full diagnostics through core.diagnostics", async () => {
    const collect = vi.fn(async () => ({
      schemaVersion: 1,
      generatedAt: "2026-04-29T03:31:20.000Z",
      overallStatus: "ok",
      summary: { ok: 1, degraded: 0, failed: 0, skipped: 0 },
      system: {},
      app: {},
      activeContext: {},
      checks: [{
        id: "system.process",
        group: "系统",
        name: "进程",
        status: "ok",
        severity: "info",
        message: "通过",
      }],
    }))
    const harness = createHarness({
      "core.diagnostics": { collect, exportBundle: vi.fn() },
    })

    const result = await harness.invoke("synapse:ops:diagnostics:run", { projectId: "project-1" })

    expect(collect).toHaveBeenCalledWith({ projectId: "project-1" })
    expect(result).toMatchObject({ overallStatus: "ok" })
  })

  it("exports diagnostics bundle through core.diagnostics", async () => {
    const report = {
      schemaVersion: 1,
      generatedAt: "2026-04-29T03:31:20.000Z",
      overallStatus: "ok",
      summary: { ok: 1, degraded: 0, failed: 0, skipped: 0 },
      system: {},
      app: {},
      activeContext: {},
      checks: [{
        id: "system.process",
        group: "系统",
        name: "进程",
        status: "ok",
        severity: "info",
        message: "通过",
      }],
    }
    const exportBundle = vi.fn(async () => ({ success: true, filePath: "/out.zip", fileCount: 3 }))
    const harness = createHarness({
      "core.diagnostics": { collect: vi.fn(), exportBundle },
    })

    const result = await harness.invoke("synapse:ops:diagnostics:export-bundle", { report })

    expect(exportBundle).toHaveBeenCalledWith({ report })
    expect(result).toEqual({ success: true, filePath: "/out.zip", fileCount: 3 })
  })
```

Change `createHarness()` to accept services:

```ts
function createHarness(services: Record<string, unknown> = {}) {
  const harness = createInMemoryHarness()
  const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
    if (serviceId in services) return services[serviceId] as T
    throw new Error("service not registered")
  }
  harness.registry.register(opsIpcModule, { moduleId: "ops", resolve })
  return harness
}
```

- [ ] **Step 6: Expose preload methods**

In `desktop/src/types/bridge.ts`, add near the existing imports:

```ts
import type {
  SynapseDiagnosticsBundleExportResult,
  SynapseDiagnosticsReport,
} from "./diagnostics"
```

In `SynapseBridge["ops"]`, add:

```ts
    runDiagnostics: (payload?: { projectId?: string }) => Promise<SynapseDiagnosticsReport>
    exportDiagnosticsBundle: (
      payload: { report: SynapseDiagnosticsReport },
    ) => Promise<SynapseDiagnosticsBundleExportResult>
```

In `desktop/electron/preload.ts`, add under `ops`:

```ts
    runDiagnostics: (payload) => invoke(IPC_CHANNELS.ops.runDiagnostics)(payload ?? {}),
    exportDiagnosticsBundle: (payload) => invoke(IPC_CHANNELS.ops.exportDiagnosticsBundle)(payload),
```

- [ ] **Step 7: Generate IPC channels**

Run:

```bash
pnpm desktop:generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` includes `runDiagnostics` and `exportDiagnosticsBundle`.

- [ ] **Step 8: Run IPC tests and codegen check**

Run:

```bash
pnpm desktop:test -- desktop/electron/modules/ops/__tests__/ipc.test.ts
pnpm desktop:check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/registry.ts desktop/electron/modules/ops/ipc.ts desktop/electron/modules/ops/__tests__/ipc.test.ts desktop/src/types/bridge.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat: wire diagnostics ipc"
```

---

### Task 7: Diagnostics Renderer Panel

**Files:**
- Create: `desktop/src/modules/settings/components/diagnostics-panel.tsx`
- Create: `desktop/src/modules/settings/components/__tests__/diagnostics-panel.test.tsx`

- [ ] **Step 1: Write renderer tests**

Create `desktop/src/modules/settings/components/__tests__/diagnostics-panel.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import {
  DiagnosticsPanel,
  DiagnosticsReportDetails,
  groupChecks,
} from "@/modules/settings/components/diagnostics-panel"
import type { SynapseDiagnosticsReport } from "@/types/diagnostics"

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    ops: {
      runDiagnostics: vi.fn(),
      exportDiagnosticsBundle: vi.fn(),
    },
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: vi.fn(),
    promise: async <T,>(task: () => Promise<T>) => task(),
  }),
}))

describe("DiagnosticsPanel", () => {
  it("starts with export and raw JSON disabled", () => {
    const html = renderToStaticMarkup(<DiagnosticsPanel />)

    expect(html).toContain("运行诊断后显示结果。")
    expect(html).toContain("导出诊断包")
    expect(html).toContain("原始 JSON")
    expect(html).toContain("disabled")
  })

  it("renders grouped details with long values", () => {
    const html = renderToStaticMarkup(<DiagnosticsReportDetails report={createReport()} />)

    expect(html).toContain("系统")
    expect(html).toContain("进程")
    expect(html).toContain("/Users/liyang/Documents/very-long-project-path-that-should-wrap")
    expect(html).toContain("复制")
  })

  it("groups checks by group name", () => {
    const groups = groupChecks(createReport().checks)

    expect(groups.get("系统")?.map((check) => check.id)).toEqual(["system.process"])
  })
})

function createReport(): SynapseDiagnosticsReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-04-29T03:31:20.000Z",
    overallStatus: "ok",
    summary: { ok: 1, degraded: 0, failed: 0, skipped: 0 },
    system: {},
    app: {},
    activeContext: {},
    checks: [{
      id: "system.process",
      group: "系统",
      name: "进程",
      status: "ok",
      severity: "info",
      message: "通过",
      details: {
        path: "/Users/liyang/Documents/very-long-project-path-that-should-wrap",
      },
    }],
  }
}
```

- [ ] **Step 2: Run the failing renderer test**

Run:

```bash
pnpm desktop:test -- desktop/src/modules/settings/components/__tests__/diagnostics-panel.test.tsx
```

Expected: FAIL because `DiagnosticsPanel` does not exist.

- [ ] **Step 3: Implement diagnostics panel**

Create `desktop/src/modules/settings/components/diagnostics-panel.tsx`:

```tsx
import { ClipboardCopy, Download, LoaderCircle, Play, RefreshCw } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseDiagnosticsCheck,
  SynapseDiagnosticsReport,
  SynapseDiagnosticsStatus,
} from "@/types/diagnostics"

const logger = createRendererLogger("settings.diagnostics")

function DiagnosticsPanel() {
  const { error: showError, promise } = useAppNotifications()
  const [report, setReport] = useState<SynapseDiagnosticsReport | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isJsonOpen, setIsJsonOpen] = useState(false)

  const rawJson = useMemo(() => report ? JSON.stringify(report, null, 2) : "", [report])
  const handleRun = useCallback(async () => {
    setIsRunning(true)
    logger.info("Diagnostics run initiated.")
    try {
      const nextReport = await promise(
        () => requireSynapseBridge().ops.runDiagnostics(),
        {
          loading: "正在运行诊断...",
          success: () => "诊断完成",
          error: (error) => error instanceof Error ? error.message : "诊断失败",
        },
      )
      setReport(nextReport)
    } catch (error) {
      logger.error("Diagnostics run failed.", error)
    } finally {
      setIsRunning(false)
    }
  }, [promise])

  const handleExport = useCallback(async () => {
    if (!report) return
    setIsExporting(true)
    logger.info("Diagnostics bundle export initiated.")
    try {
      const result = await promise(
        () => requireSynapseBridge().ops.exportDiagnosticsBundle({ report }),
        {
          loading: "正在导出诊断包...",
          success: (result) => result.success ? "诊断包已导出" : null,
          error: (error) => error instanceof Error ? error.message : "导出诊断包失败",
        },
      )
      if (result.success && result.filePath) {
        setReport({
          ...report,
          bundle: {
            lastExportedAt: new Date().toISOString(),
            lastExportPath: result.filePath,
          },
        })
      }
    } finally {
      setIsExporting(false)
    }
  }, [promise, report])

  const handleCopyJson = useCallback(async () => {
    if (!rawJson) return
    try {
      await navigator.clipboard.writeText(rawJson)
    } catch (error) {
      showError(error instanceof Error ? error.message : "复制失败")
    }
  }, [rawJson, showError])

  return (
    <>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-2">
                <CardTitle>诊断</CardTitle>
                {report ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <StatusBadge status={report.overallStatus} />
                    <span>{formatDate(report.generatedAt)}</span>
                    <span>通过 {report.summary.ok}</span>
                    <span>异常 {report.summary.degraded}</span>
                    <span>失败 {report.summary.failed}</span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">运行诊断后显示结果。</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={isRunning} onClick={() => void handleRun()}>
                  {isRunning ? (
                    <LoaderCircle className="animate-spin" data-icon="inline-start" />
                  ) : report ? (
                    <RefreshCw data-icon="inline-start" />
                  ) : (
                    <Play data-icon="inline-start" />
                  )}
                  运行诊断
                </Button>
                <Button variant="outline" disabled={!report || isExporting} onClick={() => void handleExport()}>
                  {isExporting ? (
                    <LoaderCircle className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Download data-icon="inline-start" />
                  )}
                  导出诊断包
                </Button>
                <Button variant="outline" disabled={!report} onClick={() => setIsJsonOpen(true)}>
                  原始 JSON
                </Button>
              </div>
            </div>
          </CardHeader>
          {report?.bundle?.lastExportPath ? (
            <CardContent>
              <LongValueRow label="导出位置" value={report.bundle.lastExportPath} />
            </CardContent>
          ) : null}
        </Card>

        {report ? <DiagnosticsReportDetails report={report} /> : null}
      </div>

      <Dialog open={isJsonOpen} onOpenChange={setIsJsonOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>原始 JSON</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-96 rounded-md border">
            <pre className="min-w-0 overflow-x-auto p-4 text-sm">
              {rawJson}
            </pre>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsJsonOpen(false)}>关闭</Button>
            <Button onClick={() => void handleCopyJson()}>
              <ClipboardCopy data-icon="inline-start" />
              复制 JSON
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DiagnosticsReportDetails({ report }: { report: SynapseDiagnosticsReport }) {
  const groups = useMemo(() => groupChecks(report.checks), [report])

  return (
    <>
      {Array.from(groups.entries()).map(([group, checks]) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle className="text-base">{group}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {checks.map((check, index) => (
              <div key={check.id} className="flex flex-col gap-3">
                {index > 0 ? <Separator /> : null}
                <CheckRow check={check} />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </>
  )
}

function CheckRow({ check }: { check: SynapseDiagnosticsCheck }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{check.name}</div>
          <p className="break-words text-sm text-muted-foreground">{check.message}</p>
        </div>
        <StatusBadge status={check.status} />
      </div>
      {check.details ? (
        <div className="flex flex-col gap-2">
          {Object.entries(check.details).map(([key, value]) => (
            <LongValueRow key={key} label={key} value={formatValue(value)} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function LongValueRow({ label, value }: { label: string; value: string }) {
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(value)
  }, [value])

  return (
    <div className="grid min-w-0 gap-2 text-sm md:grid-cols-[10rem_minmax(0,1fr)_auto]">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all">{value}</span>
      <Button variant="ghost" size="sm" onClick={() => void handleCopy()}>
        <ClipboardCopy data-icon="inline-start" />
        复制
      </Button>
    </div>
  )
}

function StatusBadge({ status }: { status: Exclude<SynapseDiagnosticsStatus, "skipped"> | SynapseDiagnosticsStatus }) {
  return <Badge variant={status === "failed" ? "destructive" : "secondary"}>{getStatusLabel(status)}</Badge>
}

function getStatusLabel(status: SynapseDiagnosticsStatus): string {
  if (status === "ok") return "通过"
  if (status === "degraded") return "异常"
  if (status === "failed") return "失败"
  return "跳过"
}

function groupChecks(checks: SynapseDiagnosticsCheck[]): Map<string, SynapseDiagnosticsCheck[]> {
  return checks.reduce((groups, check) => {
    const group = groups.get(check.group) ?? []
    group.push(check)
    groups.set(check.group, group)
    return groups
  }, new Map<string, SynapseDiagnosticsCheck[]>())
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2)
}

export { DiagnosticsPanel, DiagnosticsReportDetails, groupChecks }
```

- [ ] **Step 4: Run renderer test**

Run:

```bash
pnpm desktop:test -- desktop/src/modules/settings/components/__tests__/diagnostics-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/settings/components/diagnostics-panel.tsx desktop/src/modules/settings/components/__tests__/diagnostics-panel.test.tsx
git commit -m "feat: add diagnostics settings panel"
```

---

### Task 8: Add Settings Sidebar Entry

**Files:**
- Modify: `desktop/src/modules/settings/types.ts`
- Modify: `desktop/src/modules/settings/data.ts`
- Modify: `desktop/src/modules/settings/index.tsx`
- Test: renderer tests from Task 7 plus typecheck

- [ ] **Step 1: Add category type**

In `desktop/src/modules/settings/types.ts`, change `SettingsCategoryId` to include `diagnostics`:

```ts
type SettingsCategoryId =
  | "general"
  | "repositories"
  | "projects"
  | "scheduled-tasks"
  | "tools"
  | "variables"
  | "data-store"
  | "logs"
  | "diagnostics"
  | "about"
  | "admin"
```

- [ ] **Step 2: Add sidebar category**

In `desktop/src/modules/settings/data.ts`, add `Stethoscope` to the lucide import:

```ts
  Stethoscope,
```

Add the category after `logs`:

```ts
  {
    id: "diagnostics",
    icon: Stethoscope,
    label: "诊断",
    description: "本机检查。",
  },
```

- [ ] **Step 3: Render panel**

In `desktop/src/modules/settings/index.tsx`, import:

```ts
import { DiagnosticsPanel } from "@/modules/settings/components/diagnostics-panel"
```

Add after the logs panel render:

```tsx
        {isReady && activeCategory === "diagnostics" ? <DiagnosticsPanel /> : null}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm desktop:test -- desktop/src/modules/settings/components/__tests__/diagnostics-panel.test.tsx
pnpm desktop:typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/settings/types.ts desktop/src/modules/settings/data.ts desktop/src/modules/settings/index.tsx
git commit -m "feat: add diagnostics settings entry"
```

---

### Task 9: Full Verification

**Files:**
- No planned source changes unless verification reveals issues.

- [ ] **Step 1: Run hard constraints**

Run:

```bash
pnpm desktop:check:hard-constraints
```

Expected: PASS.

- [ ] **Step 2: Run IPC codegen check**

Run:

```bash
pnpm desktop:check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm desktop:typecheck
```

Expected: PASS.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm desktop:test
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: no unstaged files after task commits. When verification fixes are needed, stage and commit them:

```bash
git add <fixed-files>
git commit -m "fix: stabilize diagnostics verification"
```

---

## Implementation Notes

- Do not start the development server.
- Do not use browser preview or Playwright for verification.
- Do not add dependencies.
- Do not add custom CSS, inline styles, hard-coded colors, or Tailwind arbitrary colors.
- Do not make diagnostics read secrets, browser history, clipboard, shell history, SSH keys, or full environment variable values.
- Bundle export writes outside app data only after `PermissionGuard.check()` and records `AuditSink` outcome.
- A failed individual probe becomes a failed check; it should not throw away the whole report.
- Renderer never assembles diagnostics from many bridge calls.
