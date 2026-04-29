# Diagnostics Page Design

## Goal

Add a Diagnostics page under Settings for production troubleshooting and internal functional checks.

The page should help a user produce one complete artifact for developers when Synapse misbehaves on their machine. It should show a clear result in the app, preserve full local values in the report, run only safe probes, and export a single ZIP package containing the report, logs, config snapshot, and Data Store database copy.

## Decisions

- Add a new Settings sidebar item: `诊断`.
- Keep the existing `调试` page focused on log management.
- Diagnostics do not run automatically. The user runs them manually.
- Use the main process as the source of truth. Renderer code triggers diagnostics and displays the result; it does not assemble the report.
- Use safe probes, not destructive or high-side-effect feature tests.
- Export a single ZIP package.
- Include complete values in the report and exported files. Do not show an extra export warning.
- Do not proactively read obvious secret stores such as keychains, browser history, clipboard, shell history, SSH keys, or full environment variable values.

## Existing Code Context

Settings already uses a sidebar module:

- `desktop/src/modules/settings/index.tsx`
- `desktop/src/modules/settings/data.ts`
- `desktop/src/modules/settings/types.ts`

The app already exposes partial diagnostics through:

- `desktop/electron/modules/ops/ipc.ts`
- `desktop/src/types/bridge.ts`
- `desktop/electron/preload.ts`

Related sources to reuse:

- Log export and archive logic in `desktop/electron/services/log-store.ts`
- Config backup shape in `desktop/electron/services/config-backup-service.ts`
- Data Store status and database export in `desktop/electron/data-store/service.ts`
- Data Store CLI and MCP checks in `desktop/electron/data-store/cli-installer.ts`, `desktop/electron/data-store/mcp-installer.ts`, and `desktop/electron/data-store/mcp-server.ts`
- Service/Data repository inspect types in `desktop/electron/runtime/service-registry/` and `desktop/electron/runtime/data-repo/`

## User Flow

1. User opens Settings.
2. User selects `诊断`.
3. Page shows a not-run state with `运行诊断`.
4. User clicks `运行诊断`.
5. Renderer calls the new ops IPC.
6. Main process collects system info, app info, existing service status, and safe probe results.
7. Page renders the conclusion panel and grouped details.
8. User can open `原始 JSON` in a modal.
9. User can click `导出诊断包`.
10. Main process asks where to save a ZIP and writes the full package.

## Page Structure

The page has three information layers.

### Conclusion Panel

Show short values only:

- Overall status: `通过`, `部分异常`, or `失败`
- Generated time
- Check counts by status
- Active repository and project names; show `未选择` when absent
- Last export path after a successful export

Actions:

- `运行诊断`
- `导出诊断包`
- `原始 JSON`

`导出诊断包` and `原始 JSON` are disabled until a report exists.

### Grouped Details

Render grouped sections:

- `系统`: platform, arch, OS release, app version, Electron/Chrome/Node versions, process info.
- `应用`: single instance lock, userData path, logs path, `app.isPackaged()`, process pid.
- `路径与权限`: temp write/read/delete probe, log directory, configured repositories, configured projects.
- `服务`: migrated IPC modules, core service registry inspect, service failures if available.
- `Agent`: `AgentRuntimeService.getStatus()` for the selected or first project.
- `Data Store`: DB path, size, table count, HTTP status, CLI debug info, MCP HTTP status, MCP registrations.
- `连接器`: Side-channel, Webhook, Relay, Feishu status.
- `日志与配置`: log file count/size and exported bundle contents.

Group rows can show `通过`, `异常`, `失败`, or `跳过`.

### Raw JSON Dialog

The main page does not render the full JSON inline.

Clicking `原始 JSON` opens a shadcn `Dialog` with:

- `DialogTitle`: `原始 JSON`
- A fixed-height `ScrollArea`
- A monospace preformatted block
- `复制 JSON`
- `关闭`

The dialog preserves the full JSON string.

## Long Value Layout

Diagnostics contain long paths, PATH-like strings, table names, stack traces, and error messages. The layout must not collapse or hide values.

Rules:

- Summary cards never contain long paths or stack traces.
- Detail rows use a stable layout equivalent to `label + minmax(0, 1fr) + action`.
- Long plain values wrap with `break-all` or `break-words`.
- Stack traces, logs, and JSON snippets use a scrollable monospace block with horizontal overflow.
- Long values include a copy action.
- On narrow widths, detail rows stack vertically.
- No field should rely on truncation as the only way to see a value.

## Report Model

Add renderer/shared types in a dedicated file and import them from bridge types:

- `desktop/src/types/diagnostics.ts`
- `desktop/src/types/bridge.ts`

Use this shape:

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
```

Overall status:

- Any failed error check -> `failed`
- Any degraded warning check -> `degraded`
- Otherwise -> `ok`

## Main Process Design

Add a focused diagnostics service:

- `desktop/electron/services/diagnostics-service.ts`
- Bootstrap descriptor id: `core.diagnostics`

Wire it through `ServiceRegistry`, not a global singleton. The service receives explicit dependencies from the bootstrap descriptor:

- `ServiceRegistry` for `inspect()`
- `DataRepository` for `inspect()`
- `PermissionGuard`
- `AuditSink`
- logger

Update bootstrap wiring:

- Add `coreDiagnosticsDescriptor` to `desktop/electron/bootstrap/descriptors.ts`
- Register it in `desktop/electron/bootstrap/registry.ts`
- Give it normal main-process criticality and dependencies on data repository, permission guard, audit sink, and logging

Keep `desktop/electron/modules/ops/ipc.ts` thin by resolving `core.diagnostics` and calling service methods.

New bridge methods:

- `ops.runDiagnostics(payload?: { projectId?: string })`
- `ops.exportDiagnosticsBundle(payload: { report: SynapseDiagnosticsReport })`

Use these channels:

- `synapse:ops:diagnostics:run`
- `synapse:ops:diagnostics:export-bundle`

IPC schema should use zod and return typed records. Validate the report top-level shape and the check array shape explicitly.

Move the current `ops.diagnostics` status assembly into `desktop/electron/modules/ops/status.ts` as `collectOpsStatus(resolve, projectId?)`. The existing lightweight diagnostics endpoint and the new full diagnostics endpoint both call that helper.

### Safe Probe List

Run these checks:

- App version and single-instance lock.
- OS/platform/arch/release and Electron process versions.
- `app.getPath("userData")`, `downloads`, `temp`, and log directory availability.
- Temporary file write/read/delete under app temp or userData-scoped temp.
- Config load and basic counts: repositories, projects, active repository.
- Repository paths: exists, is directory, readable.
- Project paths: exists, is directory, readable.
- Current ops status values: version, single-instance lock, logs path, Side-channel, Webhook, Relay, Agent, Feishu.
- Log file list: count and total size.
- Data Store status: running, port, DB size, table count, DB directory.
- Data Store DB copy readiness: source path exists and can be stat'ed.
- Data Store CLI debug info.
- Data Store MCP HTTP status and target registrations.
- Agent runtime status for the selected project or first configured project.
- Service registry inspect from the diagnostics service dependency.
- DataRepository inspect from the diagnostics service dependency.
- Registered IPC module list from `registeredIpcModules`.

Do not run:

- Agent messages or new sessions.
- Network calls to external hosts.
- Destructive Data Store actions.
- Repository sync, Git push, maintenance, or content writes.
- Config import/reset.
- Log clear.
- Secret reads.

### Permissions and Audit

Because diagnostics export writes a ZIP outside app data and may copy logs/config/database into a temporary staging directory, the export path should go through `PermissionGuard.check()` and record the outcome to `AuditSink`.

Use user actor context:

```ts
actor: { kind: "user" }
context: { source: "ops.exportDiagnosticsBundle" }
```

For staging inside app temp/userData, keep the action scoped and clean it up after archive creation.

## Bundle Export

Export one ZIP with this folder root pattern:

```text
synapse-diagnostics-2026-04-29T03-31-20-000Z/
  manifest.json
  diagnostics.json
  logs/
    synapse-*.log
  config/
    config-backup.json
  data-store/
    synapse-data.db
```

`manifest.json` includes:

- schema version
- generated time
- app version
- report status
- included file list
- skipped file list with reasons

`diagnostics.json` is the full report.

`config/config-backup.json` uses the existing config backup shape. Extract `createConfigBackupPayload()` from `config-backup-service.ts` so diagnostics can create the payload without opening a save dialog.

`data-store/synapse-data.db` uses `dataStoreService.exportDatabase(targetPath)`.

Logs include current log files. Call `logStore.flush()` before copying.

Archive creation uses the platform ZIP strategy currently in `log-store.ts`. Extract `createZipArchive()` into a shared main-process utility and update log export to use the same helper.

Cancellation returns `{ success: false }`.

## Renderer Design

Add:

- `desktop/src/modules/settings/components/diagnostics-panel.tsx`

Update:

- `desktop/src/modules/settings/types.ts` to include `diagnostics`
- `desktop/src/modules/settings/data.ts` to add the category with the lucide `Stethoscope` icon
- `desktop/src/modules/settings/index.tsx` to render `DiagnosticsPanel`
- `desktop/src/types/bridge.ts` and `desktop/electron/preload.ts` for new bridge methods

Use existing shadcn components:

- `Card`
- `Button`
- `Badge`
- `Dialog`
- `ScrollArea`
- `Separator`
- `Table` only if it improves scanability for check rows

No custom colors, no inline styles, no new CSS files. Use theme tokens and utility classes only.

## Copy

Keep UI copy short:

- Page title: `诊断`
- Empty state: `运行诊断后显示结果。`
- Primary action: `运行诊断`
- Export action: `导出诊断包`
- JSON action: `原始 JSON`
- Success toast: `诊断完成`
- Export success toast: `诊断包已导出`
- Generic failure: `诊断失败`

Avoid explanatory paragraphs in the page. The grouped details and check messages carry the necessary meaning.

## Error Handling

- A single failed probe should not fail the whole diagnostics run.
- Each probe catches errors and records a failed check with the error message.
- The diagnostics run only fails globally if collection cannot produce a report at all.
- Bundle export should include a skipped list for optional artifacts that cannot be copied.
- If ZIP creation fails, return the error and leave the page result intact.
- If the user cancels save dialog, do not show an error toast.

## Testing

Unit tests:

- Diagnostics status aggregation.
- Safe probe wrapper converts thrown errors into failed checks.
- Bundle manifest includes expected files and skipped entries.
- Export cancellation returns `success: false`.
- Long value row rendering helper preserves copy actions and full values.

Renderer tests:

- Settings sidebar includes `诊断`.
- Diagnostics page initial state has disabled export/JSON actions.
- Running diagnostics renders summary and grouped checks.
- Raw JSON opens in a dialog.
- Long value rows preserve copy actions and do not rely on truncation-only display.

IPC/codegen:

- Regenerate IPC channels if the project generator requires it.
- Run `pnpm desktop:check:ipc-codegen`.

Verification commands:

```text
pnpm desktop:typecheck
pnpm desktop:test
pnpm desktop:check:hard-constraints
pnpm desktop:check:ipc-codegen
```

Do not start the development server as part of verification.

## Non-Goals

- No automatic scheduled diagnostics.
- No external network connectivity tests.
- No agent conversation execution.
- No destructive cleanup or repair actions.
- No UI for choosing individual probes in the first version.
- No redaction toggle in the first version.

## Acceptance Criteria

- Settings has a new `诊断` sidebar item.
- Diagnostics run only after the user clicks `运行诊断`.
- The page shows conclusion, grouped details, and no inline full JSON.
- Raw JSON opens in a modal and can be copied.
- Long paths, stack traces, and JSON values remain accessible without breaking layout.
- A single ZIP diagnostic package can be exported.
- The ZIP includes report, manifest, logs, config backup, and Data Store database. If a file cannot be copied, it is omitted and listed in `manifest.skipped`.
- Optional export failures are recorded in the manifest.
- Renderer does not directly assemble diagnostics from many bridge calls.
- Main-process implementation respects existing IPC, PermissionGuard, AuditSink, and hard-constraint rules.
