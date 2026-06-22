# System App Header Slot Design

## Goal

Move system app-owned header controls into the embedded app shell header when a system app is opened inside the Apps module.

The first scope is intentionally narrow: only system apps opened inside the main Apps tab are affected. Standalone system app windows keep their current in-content toolbar.

## Current State

The main app shell owns the top navigation row. Inside the Apps tab, `EmbeddedSystemAppShell` adds a second row with back, app name, and the open-in-window action.

Several system apps then render another toolbar through `SystemAppWindowShell`:

- Resource Repository: `技能 / 规则 / 提示词`
- Git: `仓库 / 环境 / 安装 Git / 访问`, plus repository actions
- Database: `数据表 / 服务状态 / 管理 / MCP`
- Usage Monitor: `CC / Codex`
- Model Price: `价格规则 / 模型覆盖`, plus refresh and filters

This creates an extra content row in embedded mode. The desired layout is one embedded app header:

- left: back button and app name
- center: app tabs
- right: app actions and the open-in-window button

## Non-Goals

- Do not redesign the global main app header.
- Do not migrate top-level modules such as Agent, Drive, Automation, Workflow, or Settings.
- Do not force IDE Management into the shared system app shell in this pass.
- Do not change standalone system app window behavior.
- Do not introduce new visual styles, custom colors, or one-off CSS.

## Recommended Approach

Add a small header slot context for embedded system apps.

`EmbeddedSystemAppShell` provides the slot context and renders the registered slot content in its header. `SystemAppWindowShell` consumes the context. When the context exists, it registers its tabs and actions with the provider and renders only its children. When the context does not exist, it falls back to the existing standalone toolbar.

This keeps the existing app APIs stable:

```tsx
<SystemAppWindowShell tabs={tabs} value={view} onValueChange={setView} actions={actions}>
  {children}
</SystemAppWindowShell>
```

System apps keep declaring their own tabs and actions in their local modules, but the placement changes automatically in embedded mode.

## Component Responsibilities

### EmbeddedSystemAppShell

- Owns the embedded header layout.
- Provides a slot context to descendants.
- Renders left, center, and right regions using the existing three-column centered header pattern.
- Keeps the app tabs visually centered regardless of left title width or right actions.
- Places the open-in-window button after app actions in the right region.
- Clears slot content when the embedded app unmounts or no app has registered content.

### SystemAppWindowShell

- Continues to be the declaration point for system app tabs and actions.
- In embedded mode, registers:
  - tab list
  - selected tab value
  - tab change callback
  - action node
- In standalone mode, renders its existing toolbar and children.
- Avoids rendering an empty embedded toolbar when there are no tabs or actions.

### SystemAppContent

- Does not need to know about header slots.
- Continues selecting the app module by `appId`.

## Layout Rules

Embedded header:

- left column: back button and app name
- center column: tabs from the active system app
- right column: app actions, then open-in-window button

If the active app registers no tabs, the center column remains empty. If it registers no actions, the right column still shows open-in-window.

Right-side app actions must use existing button, select, and tooltip components. The implementation must not add custom colors, inline styles, nested cards, or decorative copy.

## Lifecycle

The slot provider stores one active registration.

`SystemAppWindowShell` updates the registration whenever tabs, selected value, callback, or actions change. It removes the registration during cleanup.

To prevent stale controls:

- navigating back to the app launcher unmounts the active app and clears the slot
- switching from one embedded app to another replaces the slot
- unmounting after errors clears the slot

## Compatibility

Standalone system app windows render `SystemAppWindowApp`, which mounts `SystemAppContent` without `EmbeddedSystemAppShell`. Because there is no slot context, `SystemAppWindowShell` renders its current toolbar. This preserves existing standalone window behavior.

## Testing

Add or update renderer tests for:

- `EmbeddedSystemAppShell` renders registered tabs in the centered header region.
- `EmbeddedSystemAppShell` renders registered app actions before the open-in-window action.
- `SystemAppWindowShell` suppresses its own toolbar when an embedded slot provider is present.
- `SystemAppWindowShell` keeps the existing toolbar when no provider is present.
- returning to the app launcher clears slot content.
- Git embedded mode shows tabs centered and repository actions on the right.
- standalone system app window tests still see the system app toolbar.

## Rollout

Implement the shared slot mechanism first, then verify existing system app modules without changing their public usage. Only add targeted app changes if an app currently has header controls outside `SystemAppWindowShell`.

IDE Management can remain as-is in this pass because it does not use the shared system app shell today.
