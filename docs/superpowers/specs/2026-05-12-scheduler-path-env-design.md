# Synapse Scheduler PATH/Env Experience Improvement — Design Spec

> Date: 2026-05-12
> Status: Draft
> Related:
> - Root cause analysis: `~/Desktop/Synapse定时任务PATH问题分析.md`
> - Development plan: `~/Desktop/Synapse定时任务改进开发计划.md`
> - User guide: `~/Desktop/Synapse定时任务用户指南.md`

---

## 1. Problem Statement

macOS users configuring scheduled tasks with nvm/asdf/Homebrew tools frequently hit:

1. **`command not found: node`** — user wrote `PATH=...` in env field, which fully replaces the login shell PATH. The nvm bin directory is never merged back.
2. **PATH rewriting confusion** — `/bin/sh -lc` triggers macOS `path_helper`, reordering PATH silently. Users see unexpected PATH output.
3. **Missing tokens** — tokens in `~/.zshrc` are invisible to non-interactive shells spawned by scheduled tasks.
4. **No diagnostics** — when tasks fail, the run log doesn't show what PATH/env the subprocess actually received. Users can't self-diagnose.

### Root Cause

`buildAllowedEnv` in `controlled-runner.ts:721-728` uses "user fills PATH → full replace" semantics. Once the user provides any PATH value in the env field, `resolveShellPath()` is never called, so nvm/asdf/Homebrew paths are lost.

## 2. Goals

| # | Goal | Priority |
|---|------|----------|
| G1 | nvm/asdf/Homebrew tools work by default when user hasn't explicitly disabled it | P0 |
| G2 | User-specified PATH acts as "prepend + merge" not "replace" (least surprise) | P0 |
| G3 | Failed task run logs show the subprocess's actual PATH and env keys (values redacted) | P1 |
| G4 | UI provides clear hints about PATH field behavior | P1 |
| G5 | Advanced users can disable login shell wrapping (`-lc` → `-c`) to avoid `path_helper` | P2 |

### Non-Goals

- No changes to the `controlled-runner.ts` allowlist security model.
- No automatic sourcing of `~/.zshrc`.
- No secrets management (Keychain integration is a separate track).

## 3. Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Behavior change strategy for old tasks | **Unified default `merge`** (方案 A) | nvm users immediately benefit; <1% of users relied on full-replace semantics |
| pathStrategy enum values | **`"merge" \| "replace"`** (simplified from auto/merge/replace) | `auto` and `merge` have nearly identical behavior; 2 options reduce cognitive load |
| Diagnostics display timing | **Data always populated; UI shows only on failure** | Keeps success view clean; data is available for future use |
| PATH mode + posixLogin UI placement | **Contextual inline**: PATH mode under env field, posixLogin under Shell field | Each control sits next to the field it affects |
| Documentation location | **Both** `docs/scheduler/` and `website/advanced/` | Technical reference + user-facing docs |

## 4. Scope — Features F1–F6

| ID | Feature | Priority |
|----|---------|----------|
| F1 | Default PATH merge semantics in `buildAllowedEnv` | P0 |
| F2 | Env field placeholder + `FieldDescription` hint | P0 |
| F3 | Run diagnostics: `effectiveEnvKeys` + `effectivePath` summary | P1 |
| F4 | Documentation: technical reference + user guide + CHANGELOG + README link | P1 |
| F5 | Optional `posixLogin: false` toggle | P2 |
| F6 | UI PATH mode toggle (merge / replace) | P2 |

## 5. Affected Files

### 5.1 Main Process (Electron)

| File | Change |
|------|--------|
| `desktop/electron/runtime/process/controlled-runner.ts` | Extend `buildAllowedEnv` with `pathStrategy`; add `diagnostics` to `ControlledProcessResult`; new helpers `computePath`, `splitPath`, `dedupePath` |
| `desktop/electron/services/shell-exec.ts` | No change (already supports `posixLogin` option) |
| `desktop/action-packages/builtin/shell-process.main.ts` | Pass through `pathStrategy` and `posixLogin` from config |
| `desktop/action-packages/builtin/command/schema.ts` | Add optional `pathStrategy` and `posixLogin` fields |
| `desktop/action-packages/builtin/script/schema.ts` | Same as command/schema.ts |
| `desktop/action-packages/builtin/command/manifest.ts` | Add `pathStrategy` and `posixLogin` to `configFields` and `defaultConfig` |
| `desktop/action-packages/builtin/script/manifest.ts` | Same as command/manifest.ts |

### 5.2 Renderer

| File | Change |
|------|--------|
| `desktop/action-packages/builtin/command/config.renderer.tsx` | Add placeholder, FieldDescription hint, PATH mode ToggleGroup, posixLogin Checkbox |
| `desktop/action-packages/builtin/script/config.renderer.tsx` | Same as command/config.renderer.tsx |
| `desktop/src/action-runtime/action-result-view.tsx` | Add diagnostics block (shown only when `status !== "success"`) |

### 5.3 Tests

| File | Change |
|------|--------|
| `desktop/electron/runtime/process/__tests__/controlled-runner.test.ts` | New: `buildAllowedEnv` merge/replace × Mac/Win + diagnostics population |
| `desktop/action-packages/builtin/command/__tests__/executor.test.ts` | New cases for pathStrategy passthrough; existing cases unchanged |
| `desktop/action-packages/builtin/script/__tests__/executor.test.ts` | Mirror command test additions |
| `desktop/src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx` | Placeholder, FieldDescription, PATH mode, posixLogin rendering |

### 5.4 Documentation

| File | Change |
|------|--------|
| `docs/scheduler/path-and-env.md` | New: technical reference (adapted from user guide) |
| `website/advanced/scheduler-env.md` | New: user-facing guide (VitePress format) |
| `CHANGELOG.md` | F1 behavior change entry |
| `README.md` or `desktop/README.md` | Add link to scheduler env documentation |

## 6. Detailed Design

### 6.1 F1 — PATH Merge Semantics (Core Fix)

#### Current behavior (`controlled-runner.ts:714-734`)

```ts
// If user provided PATH → use it directly, skip resolveShellPath()
let entry = findEnvEntry(env, key)
if (!entry && key === "PATH") {
  const shellPath = resolveShellPath()
  if (shellPath) entry = { key: "PATH", value: shellPath }
}
```

#### New behavior

Extend `buildAllowedEnv` signature:

```ts
type PathStrategy = "merge" | "replace"

function buildAllowedEnv(
  env: Record<string, string | undefined> | undefined,
  envAllowlist: readonly string[] | undefined,
  pathStrategy: PathStrategy = "merge",
): NodeJS.ProcessEnv
```

PATH resolution logic extracted to `computePath`:

```ts
function computePath(
  strategy: PathStrategy,
  userPath: string | undefined,
  shellPath: string | null,
  fallbackPath: string,
): string {
  // replace: use user PATH exactly (old behavior)
  if (strategy === "replace" && userPath !== undefined) {
    return userPath
  }

  // merge (default): user paths first, then shell/fallback paths, deduplicated
  const parts: string[] = []
  if (userPath) parts.push(...splitPath(userPath))
  if (shellPath) parts.push(...splitPath(shellPath))
  else parts.push(...splitPath(fallbackPath))
  return dedupePath(parts).join(pathDelimiter())
}
```

Helper functions:

```ts
import { delimiter as nodePathDelimiter } from "node:path"

function pathDelimiter(): string {
  return nodePathDelimiter // ":" on POSIX, ";" on Windows
}

function splitPath(pathValue: string): string[] {
  return pathValue.split(pathDelimiter()).filter(Boolean)
}

function dedupePath(parts: string[]): string[] {
  if (process.platform === "win32") {
    // Case-insensitive dedup on Windows
    const seen = new Set<string>()
    return parts.filter((p) => {
      const lower = p.toLowerCase()
      if (seen.has(lower)) return false
      seen.add(lower)
      return true
    })
  }
  // Case-sensitive dedup on POSIX
  const seen = new Set<string>()
  return parts.filter((p) => {
    if (seen.has(p)) return false
    seen.add(p)
    return true
  })
}
```

#### `ControlledProcessRunRequest` extension

```ts
export interface ControlledProcessRunRequest {
  // ... existing fields
  readonly pathStrategy?: PathStrategy
}
```

#### `buildLaunch` wiring

```ts
function buildLaunch(request: ControlledProcessRunRequest): ControlledProcessLaunch {
  const args = request.args ?? []
  const env = buildAllowedEnv(request.env, request.envAllowlist, request.pathStrategy ?? "merge")
  // ... rest unchanged
}
```

#### Backward Compatibility

- Old tasks have `pathStrategy === undefined` → defaults to `"merge"`.
- **This is a behavior change.** Previously, user-provided PATH was used verbatim. Now it's merged with shell PATH.
- Mitigation: CHANGELOG entry; users who relied on full-replace can switch to `"replace"` mode in UI.
- The `<1%` of users who intentionally restricted PATH must explicitly set `pathStrategy: "replace"`.

#### Acceptance Criteria

1. No user PATH → behavior unchanged, `resolveShellPath` fallback.
2. User PATH + default `merge` → user paths first + shell PATH appended + deduplicated.
3. User PATH + `replace` → only user PATH used.
4. Windows: `;` delimiter, case-insensitive dedup.
5. macOS/Linux: `:` delimiter, case-sensitive dedup.
6. Existing test `executor.test.ts:91-127` continues to pass unchanged.

---

### 6.2 F2 — UI Placeholder + Hint

#### Changes to `command/config.renderer.tsx` and `script/config.renderer.tsx`

Add `placeholder` to env Textarea and `FieldDescription` below it:

```tsx
<Field>
  <FieldLabel htmlFor="task-action-command-env">环境变量</FieldLabel>
  <FieldContent>
    <Textarea
      id="task-action-command-env"
      rows={3}
      placeholder={"每行一条 KEY=VALUE\n示例：GITEE_TOKEN=xxx"}
      value={stringifyRecordText(value.env)}
      onChange={(event) => onChange({ ...value, env: parseRecordText(event.target.value) })}
    />
    <FieldDescription>
      不写 PATH 时自动使用登录终端 PATH。写了 PATH 默认与终端 PATH 合并。
    </FieldDescription>
  </FieldContent>
</Field>
```

Note: The development plan references `FieldHint`, but this component does not exist in the codebase. `FieldDescription` (from `desktop/src/components/ui/field.tsx`) is the correct existing component.

#### Acceptance Criteria

1. `task-form-dialog.test.tsx` can assert on placeholder text and description keywords.
2. Copy follows product copy guidelines: short, action-oriented, no technical internals.

---

### 6.3 F3 — Run Diagnostics

#### Data layer: always populate diagnostics

Extend `ControlledProcessResult`:

```ts
export interface ControlledProcessResult {
  // ... existing fields
  readonly diagnostics?: {
    readonly envKeys: readonly string[]
    readonly pathSummary: string   // e.g. "/Users/.../.nvm/...(5 entries)"
    readonly pathEntries: readonly string[]
    readonly shell: string
    readonly args: readonly string[]
  }
}
```

In `ControlledProcessRunner.run()`, after `buildLaunch`, construct diagnostics from the launch env and attach to the result object. This happens for **all runs** (success and failure), ensuring the data is always available.

```ts
const launch = buildLaunch(request)
const pathEntries = splitPath(launch.env.PATH ?? "")
const diagnostics = {
  envKeys: Object.keys(launch.env).sort(),
  pathSummary: pathEntries.length > 0
    ? `${pathEntries[0]}${pathEntries.length > 1 ? ` ... (${pathEntries.length} entries)` : ""}`
    : "(empty)",
  pathEntries,
  shell: launch.command,
  args: [...launch.args],
}
// Attach diagnostics to the result after process completes
```

#### Transport layer: `shell-process.main.ts`

Pass `result.diagnostics` into `ActionRunResult.outputs`:

```ts
const outputs = {
  stdout: result.stdout ?? "",
  stderr: result.stderr ?? "",
  exitCode: result.exitCode,
  diagnostics: result.diagnostics,
}
```

#### UI layer: show only on failure

In `action-result-view.tsx`, render a diagnostics block only when `result.status !== "success"`:

```tsx
function ActionResultView({ result }: { readonly result: ActionRunResult }) {
  const diagnostics = result.outputs?.diagnostics as DiagnosticsData | undefined
  const showDiagnostics = result.status !== "success" && diagnostics
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* ... existing content ... */}
      {showDiagnostics ? <DiagnosticsBlock diagnostics={diagnostics} /> : null}
    </div>
  )
}
```

`DiagnosticsBlock` renders:
- **PATH**: each entry on its own line, monospace
- **环境变量 keys**: comma-separated key names (no values)

#### Redaction Policy

- `envKeys`: only key names, never values.
- `pathEntries`: directory paths, not sensitive, shown directly.
- Never dump `process.env` wholesale.

#### Acceptance Criteria

1. A deliberately failing task (`nope-command`) shows envKeys list and PATH entry count in UI.
2. User-provided env key names (e.g. `GITEE_ACCESS_TOKEN`) appear in diagnostics, but their **values never appear** in any log/output.
3. Unit test: `controlled-runner` populates diagnostics on success path too (data always present).

---

### 6.4 F4 — Documentation

| Deliverable | Location | Content |
|-------------|----------|---------|
| Technical reference | `docs/scheduler/path-and-env.md` | Adapted from user guide §1-7; developer-facing tone; explains PATH resolution chain, `buildAllowedEnv` behavior, env allowlist, `path_helper` interaction |
| User guide | `website/advanced/scheduler-env.md` | VitePress format; user-facing; covers: decision flowchart, env field format, PATH special behavior, nvm/asdf/Homebrew tips, common errors table, debug task template |
| CHANGELOG | `CHANGELOG.md` | Entry for F1 behavior change: "Scheduled task PATH is now merged with login shell PATH by default. To restore the old full-replace behavior, set PATH mode to 'replace' in the task form." |
| README link | `README.md` or `desktop/README.md` | Add link to `docs/scheduler/path-and-env.md` in the scheduled tasks section |

---

### 6.5 F5 — Optional `posixLogin: false`

#### Schema (`command/schema.ts`, `script/schema.ts`)

```ts
export const commandActionConfigSchema = z.object({
  command: z.string().min(1),
  shell: z.enum(["posix", "cmd", "powershell"]),
  env: z.record(z.string(), z.string()).optional(),
  pathStrategy: z.enum(["merge", "replace"]).optional(),
  posixLogin: z.boolean().optional(),
  timeoutMins: z.number().int().positive().nullable().optional(),
})
```

#### Manifest (`command/manifest.ts`, `script/manifest.ts`)

Add to `defaultConfig`:

```ts
defaultConfig: {
  command: "",
  shell: "posix",
  timeoutMins: 30,
  // pathStrategy and posixLogin intentionally omitted (undefined = defaults)
},
```

Add to `configFields`:

```ts
{
  name: "pathStrategy",
  kind: "enum",
  required: false,
  description: "PATH resolution strategy. 'merge' prepends user PATH to shell PATH. 'replace' uses user PATH verbatim.",
  choices: ["merge", "replace"],
},
{
  name: "posixLogin",
  kind: "boolean",
  required: false,
  description: "Launch as login shell (-lc). Disable to skip macOS path_helper.",
  defaultValue: true,
},
```

#### Transport: `shell-process.main.ts`

```ts
const shell = resolveShellCommand(input.config.shell, input.content, {
  platform,
  windowsDefault: "cmd",
  posixLogin: input.config.posixLogin,  // new
})

const result = await input.processRunner.run({
  // ... existing fields
  pathStrategy: input.config.pathStrategy,  // new
})
```

Note: `ShellActionConfig` type must be updated to include `pathStrategy` and `posixLogin`:

```ts
export type ShellActionConfig = {
  readonly shell: "posix" | "cmd" | "powershell"
  readonly env?: Record<string, string>
  readonly pathStrategy?: "merge" | "replace"
  readonly posixLogin?: boolean
  readonly timeoutMins?: number | null
}
```

#### UI: Checkbox under Shell ToggleGroup

In `command/config.renderer.tsx` and `script/config.renderer.tsx`, below the Shell ToggleGroup, when `value.shell === "posix"`:

```tsx
{value.shell === "posix" ? (
  <Field>
    <FieldContent>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={value.posixLogin !== false}
          onCheckedChange={(checked) =>
            onChange({ ...value, posixLogin: checked === true })
          }
        />
        以登录 shell 启动
      </label>
      <FieldDescription>
        关闭后跳过 macOS path_helper 对 PATH 的重排。
      </FieldDescription>
    </FieldContent>
  </Field>
) : null}
```

#### Acceptance Criteria

1. Default behavior unchanged (`-lc`).
2. When disabled, subprocess command is `/bin/sh -c "<content>"`.
3. Unit tests cover the passthrough chain from config → `resolveShellCommand` → args.

---

### 6.6 F6 — PATH Mode UI Toggle

In `command/config.renderer.tsx` and `script/config.renderer.tsx`, immediately below the env Textarea's `FieldDescription`:

```tsx
<Field>
  <FieldLabel>PATH 模式</FieldLabel>
  <FieldContent>
    <ToggleGroup
      type="single"
      variant="outline"
      className="w-full"
      value={value.pathStrategy ?? "merge"}
      onValueChange={(strategy) => {
        if (strategy) onChange({ ...value, pathStrategy: strategy as "merge" | "replace" })
      }}
    >
      <ToggleGroupItem value="merge" className="flex-1">合并</ToggleGroupItem>
      <ToggleGroupItem value="replace" className="flex-1">替换</ToggleGroupItem>
    </ToggleGroup>
    <FieldDescription>
      合并：你写的 PATH 放在登录终端 PATH 前面。替换：完全使用你写的 PATH。
    </FieldDescription>
  </FieldContent>
</Field>
```

#### Acceptance Criteria

1. Toggle switches correctly; schema serializes `pathStrategy` as `"merge"` or `"replace"`.
2. Default visual state shows "合并" selected.
3. End-to-end with F1: mock `processRunner` verifies merge vs replace PATH output on darwin.

## 7. Test Plan

### 7.1 Unit Tests (Required)

| Test File | Cases |
|-----------|-------|
| `controlled-runner.test.ts` | `buildAllowedEnv` with merge × Mac, merge × Win, replace × Mac, replace × Win, undefined defaults to merge |
| `controlled-runner.test.ts` | `dedupePath` case-sensitive (POSIX) and case-insensitive (Win) |
| `controlled-runner.test.ts` | `diagnostics` populated on success path |
| `command/__tests__/executor.test.ts` | `pathStrategy` passthrough to `processRunner.run` |
| `command/__tests__/executor.test.ts` | `posixLogin` passthrough to `resolveShellCommand` |
| `script/__tests__/executor.test.ts` | Mirror command test additions |
| `task-form-dialog.test.tsx` | Env field placeholder text rendering |
| `task-form-dialog.test.tsx` | PATH mode toggle renders with default "merge" |
| `task-form-dialog.test.tsx` | posixLogin checkbox renders when shell = posix |

### 7.2 Integration / Manual Tests

Per AGENTS.md rules, these are validated by the user before merge:

1. **Mac + nvm**: env field empty, run `node -v` → outputs nvm node version.
2. **Mac + nvm + user PATH without nvm**: merge mode → node still works.
3. **Mac + replace mode**: no nvm path → `command not found: node`.
4. **Windows**: cmd/PowerShell, PATH merged with `;`.
5. **Failed task**: UI shows envKeys + PATH summary.
6. **posixLogin off**: verify `/bin/sh -c` (not `-lc`).

### 7.3 Regression

These existing tests must pass **unchanged**:

- `executor.test.ts:52-89` — "does not spread baseEnv/process.env into env so buildAllowedEnv can resolve shell PATH"
- `executor.test.ts:91-127` — "passes user-specified config.env through without spreading process.env"

## 8. Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| F1 default `merge` is a behavior change for old tasks | Medium | CHANGELOG + release notes; `replace` available as explicit opt-in |
| `resolveShellPath()` returns null on some GUI launches | Low | Fallback chain to `process.env.PATH`; diagnostics show fallback source |
| Diagnostics could leak env values if not redacted | Medium | Strict keys-only policy; PR review focus |
| Phase 0 hard constraints violated | Low | All changes extend existing interfaces; no new services/singletons |
| Cross-platform path delimiter errors | Low | Use `node:path` `delimiter` constant; unit tests for both platforms |

## 9. Compatibility

### 9.1 Data Compatibility

- `pathStrategy` and `posixLogin` are optional fields. Old task JSON deserializes without error.
- No schemaVersion bump needed.

### 9.2 User Impact

- **Most users**: nothing to do. nvm/Homebrew tools just work now.
- **Users relying on full PATH replace**: must switch to "替换" mode in UI. Estimated <1% of users.
- **CI/automation generating task JSON**: should add `pathStrategy: "replace"` if they need old behavior.

### 9.3 Schema Value Domain

The simplified enum is `"merge" | "replace"`. The development plan's `"auto"` value is **not included** because:
- `auto` and `merge` had identical runtime behavior.
- The feature has not shipped, so no existing tasks contain `"auto"`.
- If a future migration ever produces `"auto"` in JSON, the zod schema will strip it to `undefined` → defaults to `"merge"`, which is the correct behavior.

## 10. Merge Checklist (Reviewer Must-Check)

- [ ] `pnpm --filter @synapse/desktop run check:hard-constraints` passes
- [ ] `pnpm --filter @synapse/desktop run test` all green
- [ ] Existing controlled-runner / executor tests 100% unchanged / not deleted
- [ ] New tests cover F1 core cases: merge × Mac, merge × Win, replace × Mac, replace × Win, undefined→merge
- [ ] CHANGELOG documents F1 behavior change
- [ ] UI copy follows product copy guidelines (short, action-oriented, no technical internals)
- [ ] Diagnostics field never exposes env values
- [ ] Default `posixLogin = true`, old user behavior unchanged
- [ ] README link to scheduler env documentation added

## 11. Implementation Order

```
PR-A (zero code risk — docs + UI hints)
 └─ F2 + F4

PR-B (core change — careful review)
 └─ F1
     └─ F6 (depends on F1 schema fields)

PR-C (independent)
 └─ F3

PR-D (optional, by feedback)
 └─ F5
```

PR-A and PR-C are independent and can be developed in parallel.
PR-B blocks PR-D (F5 passthrough depends on the same `ShellActionConfig` type extension).

## 12. Out of Scope (Future Considerations)

- Keychain integration for token management.
- Real-time PATH preview in the form (shows merged PATH before saving).
- "Dry run" button to validate env/PATH before saving.
- Auto-detect `.nvmrc` / `.tool-versions` in cwd.
- Aggregated diagnostics sidebar in task list.
