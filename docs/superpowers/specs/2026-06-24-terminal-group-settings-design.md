# Terminal Group Settings Design

## Context

Terminal is implemented as the `desktop/app-capabilities/terminal` capability package. Groups currently support creation, listing, renaming, and deletion. A group only stores identity, name, timestamps, and sort order.

Users can create a terminal session under a group. `createSession` already accepts an explicit `cwd`, and the main process starts the shell through `node-pty`. The renderer uses xterm only as the terminal surface. Group-level startup behavior should therefore live in the terminal capability service, not in renderer code.

## Goals

- Keep creating a group lightweight: only the group name is required.
- Add a group settings entry from the existing group menu.
- Let a group define a default working directory for future terminal sessions.
- Let a group define a multi-line startup command that runs automatically for future terminal sessions.
- Keep existing sessions unchanged when group settings change.
- Prevent terminal creation when the configured group directory is invalid.
- Keep the design extensible for future group settings without exposing unimplemented UI.

## Non-Goals

- Do not add a full terminal profile system in this change.
- Do not add shell selection, environment variables, title templates, or command confirmation yet.
- Do not parse, validate, or interpret startup command syntax.
- Do not change the current terminal rendering surface or xterm theme.
- Do not make startup command an ad-hoc `createSession` input.
- Do not affect existing terminal sessions when settings are saved.

## Product Behavior

The group menu adds a `设置` item above `重命名` and `删除`.

Creating a group still opens the current small dialog and only asks for the group name. Renaming can remain as the current quick action. The settings dialog is the place for startup behavior.

Group settings contain:

- `分组名称`: editable in the settings dialog for convenience.
- `默认目录`: optional absolute directory path. When empty, terminal sessions use the existing default cwd behavior.
- `启动命令`: optional multi-line text. When present, new sessions in this group automatically execute it after the pty starts.

Saving settings only affects terminal sessions created later. Existing sessions keep their recorded `cwd`, output, status, and running process.

## Data Model

Extend the group schema with an optional `settings` object:

```ts
type TerminalGroup = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  sortOrder: number
  settings?: {
    defaultCwd?: string
    startupCommand?: string
  }
}
```

Old persisted `terminal-state.json` files that do not include `settings` remain valid. Empty strings should not be persisted as meaningful settings; trim whitespace and omit empty values where practical.

The nested `settings` object keeps future additions such as `shell`, `env`, or `titleTemplate` out of the top-level group shape.

## Service And API

Add a dedicated settings update action instead of mixing these fields into `renameGroup`:

```ts
updateGroupSettings({
  groupId,
  name,
  settings: {
    defaultCwd,
    startupCommand,
  },
})
```

The action updates the group name and settings together from the settings dialog. `renameGroup` remains available for the quick rename flow.

Expose the new action through IPC and MCP:

- Capability id: `app.terminal.group.updateSettings`
- MCP tool name: `app_terminal_group_updateSettings`
- IPC method: `updateGroupSettings`

`createSession` resolves cwd in this order:

1. Explicit `input.cwd`, when supplied by the caller.
2. The target group setting `settings.defaultCwd`, when present.
3. The existing default cwd resolver.

The startup command is group-only in this design. It is not added to `createSession` input, because arbitrary command injection should continue to go through the existing terminal write permission boundary.

## Startup Command Execution

After the pty is spawned and the session/runtime records are created, the service writes the group startup command into the pty with a trailing newline. This makes it behave like the user typed the command and pressed Enter.

Multi-line commands are sent as text. Synapse does not split, reorder, or interpret lines. The shell owns command parsing, exit behavior, and visible error output.

If the command is:

```bash
nvm use
pnpm dev
```

the service writes that text plus a final newline to the pty.

## Directory Validation

Saving settings performs only basic input normalization:

- Name must be non-empty and within the current name length limit.
- `defaultCwd`, when present, must be an absolute path.
- `startupCommand` may be multi-line text and may be empty.

Creating a session performs the real directory check:

- The resolved cwd must be absolute.
- The path must exist.
- The path must be a directory.
- The process must be able to access it.

If the configured directory is unavailable, session creation fails. No session record is created, no pty is spawned, and no startup command is executed. The renderer shows a concise error toast such as `目录不可用`.

## UI

Use the existing shadcn/Radix components and Tailwind token classes. Do not add custom colors, inline styles, gradients, nested cards, or explanatory copy.

Group menu:

- `设置`
- `重命名`
- `删除`

Settings dialog:

```text
┌──────────────────────────────┐
│ 分组设置                  [×] │
├──────────────────────────────┤
│ 分组名称  [ 构建             ] │
│ 默认目录  [ /repo/app      ] 选择 │
│ 启动命令  ┌────────────────┐ │
│           │ nvm use        │ │
│           │ pnpm dev       │ │
│           └────────────────┘ │
├──────────────────────────────┤
│                  取消   保存 │
└──────────────────────────────┘
```

Directory selection should reuse an existing folder picker bridge if the terminal app already has access to one. If no suitable bridge exists, the first implementation can accept typed absolute paths and omit the picker button rather than adding a broad new file-selection subsystem.

## Error Handling

- Loading groups with missing `settings` should not show an error.
- Saving an empty group name is blocked in the dialog and rejected by the service.
- Saving a relative default directory is rejected with a concise message.
- Creating a session with an invalid group directory fails before spawning pty.
- Startup command execution errors are shown by the shell output, not interpreted by Synapse.
- Deleting a group deletes its settings together with the group.

## Tests

Main/service tests:

- Loads old store state where groups have no `settings`.
- Persists updated group settings.
- Keeps `renameGroup` focused on the group name.
- Resolves session cwd by explicit input, group default cwd, then default cwd.
- Rejects invalid configured cwd before spawning pty.
- Writes `startupCommand` after pty creation with a trailing newline.
- Does not write startup command when the command is empty.

IPC/MCP tests:

- Registers `updateGroupSettings` with the expected channel and schema.
- Dispatches `app.terminal.group.updateSettings`.
- Validates malformed settings input.

Renderer tests:

- Shows `设置` in the group menu.
- Opens the settings dialog with existing name, default directory, and startup command.
- Saves group name and settings through `updateGroupSettings`.
- Creates a grouped terminal without passing startup command through renderer state.
- Shows a user-visible error when grouped terminal creation fails because the directory is unavailable.

## Release Note

When implemented, add a pending release note explaining that terminal groups can define a default directory and startup commands for newly created terminals.
