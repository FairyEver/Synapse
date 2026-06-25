# Terminal Group Commands Design

## Context

Terminal is implemented as the `desktop/app-capabilities/terminal` capability package. A terminal group currently has optional `settings.defaultCwd` and `settings.startupCommand`. New sessions in a group use the default directory and automatically run the single startup command.

That model is too narrow for groups that need several common commands, such as `dev`, `test`, `build`, or separate service runners. Users should not need to create multiple projects or duplicate terminal groups just to store several startup commands for the same directory.

## Goals

- Move terminal startup behavior from one implicit group command to explicit named commands.
- Bind commands to terminal groups.
- Keep `+` as a clean new-terminal action that does not run a command.
- Add a separate command-launch menu beside `+`.
- Let each command define a short display name and a multi-line command body.
- Launching a command always creates a new terminal session and runs the command there.
- Preserve existing `startupCommand` data by migrating it into the command list.
- Keep the first version simple: no per-command cwd, no sorting UI, no shell/env profile system.

## Non-Goals

- Do not add command presets to project settings.
- Do not add a global command library across groups.
- Do not let command launch write into the currently selected terminal.
- Do not add per-command working directories in the first version.
- Do not parse, validate, or interpret shell syntax.
- Do not add drag sorting, cloning, import/export, icons, colors, or command categories yet.
- Do not keep the old automatic group `startupCommand` behavior for new empty terminals.

## Product Behavior

Each terminal group owns its commands. The group default directory remains the execution directory for all commands in that group.

The group header has three actions:

```text
    新建空终端
<>   以命令启动
...  分组操作
```

`+` creates a new terminal session in the group default directory and does not run any command.

The command-launch icon opens a dropdown. When commands exist, the menu lists command names in creation order and includes `管理命令` at the bottom. Selecting a command creates a new terminal session, titles it with the command name, runs the command body, and focuses the new session.

When no commands exist, the command-launch dropdown only shows `管理命令`.

The group `...` menu keeps group management actions and adds `命令`:

```text
设置
命令
重命名
删除
```

`设置` only contains group basics: name and default directory. It no longer shows startup command text.

`命令` opens command management for that group.

## UI Shape

Main terminal layout:

```text
终端
┌──────────────────────────────┬────────────────────────────────────┐
│ [新建分组]                   │                                    │
│                              │  当前终端输出区域                  │
│ ▾ 前端项目        [+] [<>] […]│                                    │
│   dev                         │                                    │
│   test                        │                                    │
│   build                       │                                    │
│                              │                                    │
│ ▾ 后端服务        [+] [<>] […]│                                    │
│   api                         │                                    │
└──────────────────────────────┴────────────────────────────────────┘
```

Command launch menu:

```text
点击 [<>]

┌──────────────────┐
│ dev              │
│ test             │
│ build            │
├──────────────────┤
│ 管理命令          │
└──────────────────┘
```

Group settings dialog:

```text
分组设置
┌────────────────────────────┐
│ 分组名称    [前端项目      ] │
│ 默认目录    [/repo/web   ] [选择] │
│                            │
│                 [取消] [保存] │
└────────────────────────────┘
```

Command management dialog:

```text
命令
┌────────────────────────────────────┐
│ dev                         [编辑] [删除] │
│ pnpm dev                           │
│                                    │
│ test                        [编辑] [删除] │
│ pnpm test                          │
│                                    │
│ build                       [编辑] [删除] │
│ pnpm build                         │
│                                    │
│ [新增命令]                  [关闭]        │
└────────────────────────────────────┘
```

Add/edit command form:

```text
命令
┌────────────────────────────┐
│ 名称        [dev          ] │
│ 命令内容                  │
│ ┌────────────────────────┐ │
│ │ nvm use                │ │
│ │ pnpm dev               │ │
│ └────────────────────────┘ │
│                 [取消] [保存] │
└────────────────────────────┘
```

Use existing shadcn/Radix components, lucide icons, and Tailwind token classes. Do not add custom colors, inline styles, gradients, nested cards, or explanatory copy.

## Data Model

Extend terminal group settings with a command list:

```ts
type TerminalGroupSettings = {
  defaultCwd?: string
  commands?: TerminalGroupCommand[]
}

type TerminalGroupCommand = {
  id: string
  name: string
  command: string
  createdAt: string
  updatedAt: string
}
```

Validation rules:

- `name` is required, trimmed, and capped for menu display.
- `command` is required after normalizing line endings and trimming outer whitespace.
- `command` can be multi-line and uses the existing command size limit.
- Empty command arrays should be omitted from persisted settings where practical.

Existing persisted `settings.startupCommand` remains readable for compatibility but is not part of the target model.

## Migration

When a group is loaded with `settings.startupCommand` and without commands, convert it into:

```ts
{
  id: generatedId,
  name: "启动命令",
  command: oldStartupCommand,
  createdAt: group.updatedAt,
  updatedAt: group.updatedAt,
}
```

After normalization, the old `startupCommand` field should not be emitted in saved state. The UI should never show both old startup command and new commands.

The migrated command does not run when users click `+`. It only runs when selected from the command-launch menu.

## Service And API

Keep command management inside the terminal capability package.

Add service methods for command lifecycle:

```ts
createGroupCommand({ groupId, name, command })
updateGroupCommand({ groupId, commandId, name, command })
deleteGroupCommand({ groupId, commandId })
```

Add a command launch method:

```ts
createSessionFromCommand({
  groupId,
  commandId,
  cols,
  rows,
})
```

This method resolves the group and command, resolves cwd from `settings.defaultCwd` or the existing default cwd resolver, creates a new session titled with the command name, then writes the command body to the pty with a trailing newline.

`createSession` should create a clean terminal and should not automatically run group commands.

The existing `runStartupCommand` IPC path should be retired or kept only as a private compatibility path during implementation. New UI and MCP callers should use command launch instead of a session-level startup-command retry.

## IPC And MCP

Expose command lifecycle and command launch through preload/bridge types.

MCP capabilities should be updated if terminal tools are exposed through Synapse MCP. Command launch is a shell execution boundary and should use the same permission/audit posture as writing terminal input or updating command text.

Suggested capability ids:

- `app.terminal.groupCommand.create`
- `app.terminal.groupCommand.update`
- `app.terminal.groupCommand.delete`
- `app.terminal.groupCommand.launch`

Suggested tool names:

- `app_terminal_groupCommand_create`
- `app_terminal_groupCommand_update`
- `app_terminal_groupCommand_delete`
- `app_terminal_groupCommand_launch`

If naming validation rejects this casing, choose the nearest existing terminal capability naming style and keep all constants, schemas, dispatcher cases, and tests aligned.

## Error Handling

- Loading old groups without `settings` remains valid.
- Loading old groups with `startupCommand` migrates silently.
- Saving a command with an empty name or empty command is blocked in the renderer and rejected by the service.
- Launching a command with an invalid group directory fails before spawning pty.
- Launching a deleted or unknown command shows a concise failure toast.
- Shell-level command errors are visible in terminal output and are not interpreted by Synapse.
- Deleting a group deletes its commands with the group.

## Testing

Main/service tests:

- Loads old state with no settings.
- Migrates `settings.startupCommand` into `settings.commands`.
- Persists migrated state without the old `startupCommand` field.
- Creates, updates, and deletes group commands.
- Keeps `createSession` clean and does not run migrated commands.
- Launches a command by creating a new session, applying the group cwd, writing the command with a trailing newline, and using the command name as title.
- Rejects invalid group cwd before spawning pty.

IPC/MCP tests:

- Registers command lifecycle channels and schemas.
- Dispatches command lifecycle capabilities.
- Applies permission/audit checks to command text mutation and command launch.
- Validates malformed command input.

Renderer tests:

- Group settings dialog no longer contains `启动命令`.
- Group header shows clean terminal, command launch, and group menu actions.
- Command launch menu lists command names and includes `管理命令`.
- Empty command launch menu opens management from `管理命令`.
- Clicking a command calls command launch and focuses the created session.
- Command management can add, edit, and delete commands.
- Existing migrated command appears as `启动命令`.

## Release Note

When implemented, add a pending release note explaining that terminal groups now support multiple named commands, `+` creates a clean terminal, and commands can be launched from a dedicated group menu.
