# Dock Customization Design

Date: 2026-06-27

## Goal

Allow users to control which system apps appear in the bottom Dock, change their order, remove pinned apps, restore the default Dock, and quickly pin or unpin apps from the launcher and Dock menus.

The design keeps the Dock itself stable as a launch and switch surface. Full editing lives in Settings. Lightweight pin and unpin actions are available where users naturally encounter apps.

## Product Decisions

### Chosen Approach

Use a hybrid model:

```text
Settings -> Dock 栏
├─ Full management: add, remove, reorder, restore default

Launcher
├─ App menu: open, pin to Dock, unpin from Dock, manage Dock

Bottom Dock
├─ Left click: open or switch app
└─ Right click menu: open, unpin from Dock, manage Dock
```

Rejected alternatives:

- Settings only: stable but too indirect when a user is already looking at an app in the launcher.
- Direct Dock drag editing: intuitive but higher risk because the Dock combines horizontal scrolling, active state, tooltips, and launch clicks.

### Entry Points

Settings gets a new top-level category:

```text
设置
├─ 账号
├─ 基础设置
├─ Dock 栏
├─ 资源仓库
├─ 项目和知识库
├─ 模型与供应商
├─ 私人令牌
├─ 诊断日志
└─ 关于 Synapse
```

The launcher and Dock menus expose "管理 Dock", which opens Settings and selects the Dock category.

### Settings Dock Page

Use a vertical list, not an icon grid:

```text
Dock 栏

已固定
┌──────────────────────────────────────┐
│ ⋮⋮  [icon] 对话          ↑  ↓  移除 │
│ ⋮⋮  [icon] 云盘          ↑  ↓  移除 │
│ ⋮⋮  [icon] 终端          ↑  ↓  移除 │
│ ⋮⋮  [icon] 启动器        ↑  ↓       │
└──────────────────────────────────────┘

可添加
┌──────────────────────────────────────┐
│     [icon] 数据库              添加 │
│     [icon] 截图                添加 │
│     [icon] 快捷输入            添加 │
└──────────────────────────────────────┘

[恢复默认]
```

The page does not show per-app descriptions. App icon, name, and actions are enough for this management task.

### Launcher App Menu

Launcher remains an app grid. Each app supports a lightweight menu through a hover or focus "more" button and through right click.

```text
App menu
├─ 打开
├─ 固定到 Dock       shown when not pinned
├─ 从 Dock 移除      shown when pinned and removable
└─ 管理 Dock
```

The card body still opens the app. The menu trigger does not open the app.

### Dock App Menu

Dock icons keep their current left-click behavior. Right click opens a menu:

```text
Dock icon menu
├─ 打开
├─ 从 Dock 移除      shown when removable
└─ 管理 Dock
```

The Dock does not support drag sorting in this version.

## Behavior Rules

### Immediate Persistence

All actions are immediate:

- Add app.
- Remove app.
- Move up.
- Move down.
- Drag reorder.
- Restore default.

There is no Save button. Failed writes roll back the optimistic UI and show an error toast.

### Required Launcher

The launcher is the only non-removable Dock app.

Rules:

- Launcher is included by default.
- Launcher can be reordered.
- Launcher cannot be removed.
- If persisted config lacks launcher, normalization adds it back.
- Settings can be removed and later re-added from the launcher.

### Adding Apps

Newly pinned apps insert immediately before the current launcher position.

Examples:

```text
Before:
对话 -> 云盘 -> 终端 -> 启动器

Pin 数据库:
对话 -> 云盘 -> 终端 -> 数据库 -> 启动器
```

If a user moved launcher to the front:

```text
Before:
启动器 -> 对话 -> 云盘

Pin 数据库:
数据库 -> 启动器 -> 对话 -> 云盘
```

### Removing Current App

Unpinning the currently open app does not close or switch the current content view. It only removes the Dock entry.

The existing workflow visibility behavior remains the exception: if workflow becomes unavailable through its existing visibility control, the app continues to fall back to the default visible Dock app as it does today.

### Visibility

Dock management only exposes current launchable apps and respects existing visibility rules.

If a pinned app becomes invisible:

- It is not shown in the Dock.
- It is not shown as addable while invisible.
- Its persisted order is preserved.
- It returns to the same relative position when visible again.

### Limits

There is no hard limit on pinned app count. The Dock keeps fixed icon sizing and uses its existing horizontal scroll behavior when items overflow.

### Restore Default

Restore default is immediate and does not open a confirmation dialog. It writes the default Dock list and shows a success toast. On failure, the previous Dock state remains active and an error toast appears.

## Data Model

Continue using:

```text
config.global.dockAppIds
```

Do not add a DataRepository namespace. Dock layout is a global preference already represented in the config model and config backup flow.

### Normalization

Separate default seeding from config cleanup.

```text
seedDefaultDockAppIds()
├─ Used when dockAppIds is missing or undefined.
└─ Returns DEFAULT_DOCK_APP_IDS.

normalizeDockAppIds(values)
├─ Filters unknown app ids.
├─ Removes duplicates.
├─ Preserves valid user order.
├─ Adds launcher if missing.
└─ Does not add any other default app.
```

Examples:

```text
undefined
-> agent, drive, automation, workflow, terminal, settings, launcher

[]
-> launcher

["database", "ghost", "database"]
-> database, launcher

["workflow", "drive", "launcher"]
-> workflow, drive, launcher
```

Suggested pure helpers in `desktop/src/modules/apps/dock.ts`:

```text
normalizeDockAppIds(values)
insertDockAppId(values, appId)
removeDockAppId(values, appId)
moveDockAppId(values, appId, direction)
reorderDockAppIds(values, activeId, overId)
restoreDefaultDockAppIds()
```

## Architecture

### Dock Preference Hook

Add a shared hook:

```text
desktop/src/modules/apps/hooks/use-dock-preferences.ts
```

Responsibilities:

- Read normalized `config.global.dockAppIds`.
- Expose pinned ids and app manifests.
- Add, remove, move, reorder, and restore defaults.
- Apply optimistic updates.
- Disable operations while a save is in flight.
- Roll back on failure.
- Emit consistent toast and renderer log messages.

UI components should not hand-build config patches.

### Components

Suggested component boundaries:

```text
desktop/src/modules/settings/components/dock-panel.tsx
├─ Full Settings Dock management page.

desktop/src/modules/settings/components/sortable-dock-item.tsx
├─ One row in the pinned list.
└─ Owns dnd-kit sortable item wiring.

desktop/src/modules/apps/components/dock-app-menu.tsx
├─ Shared app Dock menu for launcher and bottom Dock.
└─ Controls visible actions through props.

desktop/src/modules/apps/components/app-launcher-grid.tsx
├─ Keeps grid layout.
└─ Adds menu trigger and right-click menu support.

desktop/src/app-shell/components/app-shell-dock.tsx
├─ Remains mostly presentational.
└─ Accepts menu action props for remove and manage Dock.
```

`AppShellDock` should not read or write config directly. `App.tsx` or the shared hook supplies actions.

### Settings Navigation

Extend settings category routing to support a Dock category.

The launcher and Dock menus call a navigation helper equivalent to:

```text
requestOpenSettingsDock()
```

That helper switches the active app to Settings and asks Settings to select the Dock category.

## Drag And Drop

Use `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities` for the Settings pinned list only.

Reasons:

- The required interaction is a one-dimensional sortable list.
- dnd-kit has a mature sortable preset for this case.
- Current `@dnd-kit/core` package metadata uses broad React peer ranges compatible with this app's React version, and the sortable package is widely used for React list sorting.
- It avoids the heavier Redux dependency path of `@hello-pangea/dnd`.
- It does not introduce a parallel component system like React Aria Components.
- Atlassian Pragmatic Drag and Drop is strong but lower-level, so it would require more custom assembly for this simple list.

Accessibility fallback:

- Every sortable row also has up and down buttons.
- Dragging is disabled while saving.
- Button ordering is treated as the stable fallback path.

## Error Handling

Persistence flow:

```text
User action
-> compute next dockAppIds
-> set optimistic dockAppIds
-> updateConfig({ global: { dockAppIds: next } })
-> success: clear optimistic state and trust returned config
-> failure: clear optimistic state, keep previous config, show toast
```

While saving:

- Disable add, remove, move, drag, reorder, and restore controls.
- Keep the current list readable.
- Avoid concurrent config writes.

Failure messages should be short and operational, for example:

```text
保存 Dock 设置失败
恢复 Dock 默认设置失败
```

## Copy

Visible UI copy should stay minimal:

- Dock 栏
- 已固定
- 可添加
- 添加
- 移除
- 固定到 Dock
- 从 Dock 移除
- 管理 Dock
- 恢复默认
- 已全部固定

Do not add explanatory paragraphs such as "此页面用于管理 Dock 栏应用".

## Testing

### Pure Function Tests

Cover `desktop/src/modules/apps/dock.ts`:

- `undefined` seeds default Dock.
- Empty array normalizes to launcher.
- Unknown ids are filtered.
- Duplicate ids are removed.
- Launcher is added if missing.
- Removing launcher is a no-op.
- New pinned apps insert before launcher.
- Hidden apps are not listed but persisted order remains.
- Restore default returns `DEFAULT_DOCK_APP_IDS`.

### Settings Dock Panel Tests

Cover:

- Pinned and addable lists render correctly.
- Add calls config update with the app inserted before launcher.
- Remove does not allow launcher removal.
- Up and down update order.
- Restore default writes default ids.
- Saving state disables controls.
- Failed save rolls back and shows an error.

### Launcher And Menu Tests

Cover:

- Unpinned apps show "固定到 Dock".
- Pinned removable apps show "从 Dock 移除".
- Launcher does not show remove.
- "管理 Dock" opens Settings Dock category.
- Card click still opens the app.
- Menu trigger click does not open the app.

### Dock Component Tests

Cover:

- Existing left-click switching still works.
- Right-click menu can unpin removable apps.
- Launcher cannot be unpinned.
- Component still renders normally when menu action props are omitted.

### Drag Tests

Do not build brittle full pointer E2E tests. Test the reorder boundary and the pure reorder helper. Button-based sorting remains the stable behavior test path.

## Release Notes

Update `RELEASE_NOTES_PENDING.md` with a user-facing note:

```text
- Dock 支持自定义固定应用和排序，可在设置中管理，也能从启动器或 Dock 菜单快速固定和移除应用。
```

## References

- dnd-kit: https://github.com/clauderic/dnd-kit
- Atlassian Pragmatic Drag and Drop: https://github.com/atlassian/pragmatic-drag-and-drop
- React Aria Drag and Drop: https://react-spectrum.adobe.com/react-aria/dnd.html
- hello-pangea dnd: https://github.com/hello-pangea/dnd
