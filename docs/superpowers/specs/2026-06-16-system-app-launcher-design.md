# System App Launcher Design

Date: 2026-06-16

## Summary

Add a first-class `应用` top-level module to Synapse. It is a pure Launchpad-style launcher for low-frequency system modules. The moved modules remain normal Synapse modules, but their entry point moves from the main header into the launcher and each opens in its own single-instance child window.

First version only supports fixed system apps. It reserves an app type model for future workflow apps and web apps, but does not implement custom app creation, editing, deletion, installation, or marketplace behavior.

## Goals

- Add a top-level `应用` tab between `自动化` and `设置`.
- Remove low-frequency modules from the main header and expose them as system apps in the launcher.
- Render a refined, responsive Launchpad-style icon grid with vertical scrolling.
- Open every app in a separate `BrowserWindow`.
- Keep one window per app id; opening an already-open app focuses the existing window.
- Store each system app's launcher metadata in the owning module directory using one shared manifest shape.
- Use bitmap icon assets for app icons, not lucide icons or CSS-drawn placeholders.
- Keep system apps fixed: not deletable, not renameable, and not icon-editable.

## Non-Goals

- No workflow apps in this implementation.
- No web apps in this implementation.
- No custom app create/edit/delete UI.
- No app search, categories, dock, pagination, favorites, recent apps, or drag sorting.
- No app marketplace or installation flow.
- No permission or license-based app filtering in this phase.
- No redesign of the moved modules beyond wrapping grouped modules in app windows.

## Navigation

The main window top-level navigation becomes:

```text
对话 / 工作流 / 云盘 / 自动化 / 应用 / 设置
```

The following existing top-level entries move into `应用`:

- `技能`
- `规则`
- `提示词`
- `数据库`
- `IDE`
- `CC`
- `Codex`
- `价格`

The launcher shows these as five system apps:

| App | Type | Window content |
| --- | --- | --- |
| `资源仓库` | `system` | Tabs: `技能`, `规则`, `提示词` |
| `本地数据库` | `system` | Existing `DatabaseModule` |
| `IDE 管理` | `system` | Existing `EditorScanModule` |
| `用量监控` | `system` | Tabs: `CC`, `Codex` |
| `价格管理` | `system` | Existing `ModelPriceModule` |

## Launcher UI

`应用` is a pure launcher. It does not expose management controls.

Visual behavior:

- Use the existing `ModulePage` shell with title `应用`.
- The content area is a single vertically scrollable surface.
- The app grid is centered and responsive.
- The grid uses stable icon cells and automatically reduces columns as the window narrows.
- Each app item is one button-like target with a bitmap icon and a short name.
- App names are centered below icons.
- Hover and focus states use token-backed muted surfaces and focus rings.
- There is no search box, category sidebar, explanatory copy, management menu, delete action, rename action, or icon edit action.

Implementation should stay within the existing shadcn/Radix and Tailwind token baseline. It must not introduce custom colors, hex/rgb/hsl literals, decorative gradients, glow, nested cards, or marketing copy.

## Icon Assets

App icons are bitmap image files owned by their module directories.

Required visual direction:

- macOS-style square application icons.
- The icon image itself is the full square icon; no outer white border, no margin, no separate frame.
- Background fills the entire image.
- Shared style language across all system app icons:
  - deep graphite full-bleed background;
  - matte off-white ceramic main subject;
  - dark graphite secondary panels;
  - small muted amber accent only;
  - soft 3D lighting and rounded forms.
- No text, letters, numbers, currency symbols, logos, watermarks, emoji, sparkles, neon colors, rainbow gradients, or busy UI screenshots.

Each module manifest references its own icon asset. The launcher must not hard-code icon paths centrally.

## App Manifest Model

Each system app exposes a manifest from its owning module directory.

Proposed shape:

```ts
type SynapseAppType = "system"

type ResourceRepositoryViewId = "skill" | "rule" | "prompt"
type UsageMonitorViewId = "cc" | "codex"
type SynapseSystemAppDefaultView = ResourceRepositoryViewId | UsageMonitorViewId

type SynapseSystemAppManifest = {
  readonly id: SynapseSystemAppId
  readonly type: "system"
  readonly name: string
  readonly icon: string
  readonly windowTitle: string
  readonly defaultView?: SynapseSystemAppDefaultView
  readonly removable: false
  readonly renameable: false
  readonly iconEditable: false
}
```

Suggested files:

```text
desktop/src/modules/resource-repository/app-manifest.ts
desktop/src/modules/database/app-manifest.ts
desktop/src/modules/editor-scan/app-manifest.ts
desktop/src/modules/usage-analysis/app-manifest.ts
desktop/src/modules/model-price/app-manifest.ts
```

The shared app registry imports these manifests and exposes:

```ts
listSystemApps(): SynapseSystemAppManifest[]
getSystemAppManifest(appId: string): SynapseSystemAppManifest | null
```

The registry is the only place that assembles launcher apps. The launcher and system-app window renderer both consume the registry instead of duplicating app names or route metadata.

The type model intentionally leaves room to add future app types, but the first implementation only registers `system` apps.

## New Resource Repository Wrapper

`资源仓库` is a new wrapper app, not three separate launcher icons.

It owns a module directory:

```text
desktop/src/modules/resource-repository/
```

The wrapper renders tabs:

- `技能`
- `规则`
- `提示词`

The tab bodies reuse the existing `SkillsModule`, `RulesModule`, and `PromptsModule` where practical. If those modules currently assume top-level app state such as content dialog state or pending content open requests, the implementation should extract a narrow reusable content browser surface rather than duplicating resource UI.

The wrapper default tab is `技能`.

This tab state is local to the Resource Repository app window. It must not publish or depend on the main window's top-level navigation state.

## Usage Monitor Wrapper

`用量监控` is a new wrapper app for usage analysis.

It renders tabs:

- `CC`
- `Codex`

The tab bodies reuse `CcUsageAnalysisModule` and `CodexUsageAnalysisModule`.

The wrapper default tab is `CC`.

This tab state is local to the Usage Monitor app window. It must not publish or depend on the main window's top-level navigation state.

## System App Window Service

Add a generic main-process service:

```text
desktop/electron/services/system-app-window-service.ts
```

Responsibilities:

- Validate app ids against the system app registry.
- Open app windows with `?window=system-app&appId=<id>`.
- Keep `Map<SystemAppId, BrowserWindow>` so one app can only have one open window.
- Focus and restore an existing window when the same app is opened again.
- Remove the map entry when the window closes.
- Use existing renderer loading patterns from content, automation, and usage detail windows.
- Use app manifest `windowTitle` for the window title.

The service should expose:

```ts
open(appId: SynapseSystemAppId): Promise<void>
```

Window defaults:

- `width: 1180`
- `height: 760`
- `minWidth: 960`
- `minHeight: 640`

Use the same defaults for all first-phase system apps. Do not add per-app bounds in the first implementation unless an existing reused module cannot function at these minimums.

## IPC And Bridge

Expose one renderer bridge method:

```ts
synapse.apps.openSystemApp(appId)
```

IPC validation should reject unknown app ids before calling the window service. Unknown ids should not create a window.

The launcher uses this bridge method when an app icon is clicked.

## Renderer Window Entry

`desktop/src/main.tsx` recognizes:

```text
window=system-app
appId=<id>
```

It renders a new `SystemAppWindowApp`.

`SystemAppWindowApp`:

- reads `appId` from the URL;
- looks up the manifest in the registry;
- renders a short error state if the id is missing or unknown;
- renders the correct system app content for known ids;
- keeps window UI minimal and uses existing module surfaces.

## App Launcher Module

Add:

```text
desktop/src/modules/apps/
```

Suggested contents:

```text
desktop/src/modules/apps/index.tsx
desktop/src/modules/apps/components/app-launcher-grid.tsx
desktop/src/modules/apps/registry.ts
desktop/src/modules/apps/types.ts
desktop/src/modules/apps/system-app-window-app.tsx
```

The launcher module should contain only launcher concerns. System app metadata and icons stay in the owning module directories.

## Error Handling

- Launcher open failures show a short toast such as `打开应用失败`.
- Unknown app id in a system-app window shows a short empty/error state.
- Main-process window-service logs should include app id and app type, but no user content or secrets.
- Repeated open of an already-open app should not be treated as an error.

## Testing Strategy

Renderer tests:

- Navigation order includes `应用` after `自动化` and before `设置`.
- `技能`, `规则`, `提示词`, `数据库`, `IDE`, `CC`, `Codex`, and `价格` no longer appear as main header tabs.
- Launcher renders exactly the five first-phase system apps.
- Launcher does not render search, category, delete, rename, or icon-edit controls.
- Clicking an app calls the bridge open method with the correct app id.
- Resource Repository renders `技能 / 规则 / 提示词` tabs and defaults to `技能`.
- Usage Monitor renders `CC / Codex` tabs and defaults to `CC`.
- `SystemAppWindowApp` renders the expected content for known app ids and a short error for unknown ids.

Main-process tests:

- Window service opens a valid system app.
- Opening the same app twice focuses the existing window and does not create another one.
- Different app ids create different windows.
- Closing a window removes it from the service map.
- Unknown app ids are rejected.

Type/registry tests:

- Every first-phase system app has a manifest.
- Every system manifest has `type: "system"`, and fixed flags set to `false`.
- Every manifest references an icon path.

Regression tests:

- Existing content, database, editor-scan, usage-analysis, and model-price module tests continue to pass.
- Existing Electron hard-constraint checks continue to pass.

## Release Notes

This is user-visible. When implemented, update `RELEASE_NOTES_PENDING.md` with a short user-facing note that low-frequency modules now live under the new `应用` launcher and open as separate app windows.
