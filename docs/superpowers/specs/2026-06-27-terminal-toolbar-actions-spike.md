# Terminal Toolbar Actions Spike

## Context

Terminal is implemented as the `desktop/app-capabilities/terminal` capability package. The renderer uses xterm as the terminal surface and writes user input to the running pty through `terminalBridge.writeSession`. The main service owns sessions, pty runtimes, retained output, group settings, group commands, and stop/delete behavior.

Current terminal behaviors:

- The left sidebar groups terminal sessions and exposes group actions.
- Group commands are stored under `group.settings.commands`.
- Launching a group command creates a new terminal session and writes the command there.
- The active terminal pane is intentionally minimal: it is only the xterm surface plus transient read errors.
- Dragging files into a running terminal writes shell-quoted paths into the current session.
- Lost or exited sessions are read-only because xterm is created with `disableStdin`.

The new toolbar should add high-frequency, project-agnostic terminal actions without changing the meaning of existing group commands.

## Product Decision

Add a very small toolbar at the bottom of the active terminal pane, inside the dark terminal area and below xterm.

```text
┌──────────────────┬─────────────────────────────────────────┐
│ Terminal groups  │                                         │
│                  │                                         │
│ zsh              │                 xterm                   │
│ dev              ├─────────────────────────────────────────┤
│                  │ Ctrl+C  Clear  │ /exit /clear │ Custom Edit│
└──────────────────┴─────────────────────────────────────────┘
```

Reasons:

- Bottom placement keeps the actions next to the terminal input area without overlaying xterm content.
- The toolbar belongs to the active terminal pane, not the global app shell.
- A fixed-height bottom row remains visible while terminal output scrolls.
- The toolbar can horizontally scroll on narrow screens without wrapping.

Built-in and user-defined actions are two independent collections. Built-ins remain defined in code and never enter the management UI. User-defined actions are app-global records stored separately, so adding, removing, or changing a built-in in a later release cannot mutate user data.

User-defined actions intentionally differ from group commands: they write into the active session instead of creating a new session.

## Action Model

Represent each built-in button as a renderer-owned registry item because built-ins use existing renderer state, xterm APIs, and bridge methods.

```ts
type TerminalToolbarPlatform = "darwin" | "win32" | "linux"

type TerminalToolbarAvailability =
  | "running-session"
  | "any-session"

type TerminalToolbarAction =
  | {
      id: string
      label: string
      ariaLabel: string
      platforms: TerminalToolbarPlatform[]
      availability: TerminalToolbarAvailability
      kind: "terminal-sequence"
      sequence: string | Partial<Record<TerminalToolbarPlatform, string>>
    }
  | {
      id: string
      label: string
      ariaLabel: string
      platforms: TerminalToolbarPlatform[]
      availability: TerminalToolbarAvailability
      kind: "xterm-local"
      operation: "clear"
    }
  | {
      id: string
      label: string
      ariaLabel: string
      platforms: TerminalToolbarPlatform[]
      availability: TerminalToolbarAvailability
      kind: "shell-command"
      command: string | Partial<Record<TerminalToolbarPlatform, string>>
    }
```

User-defined actions use a separate persisted model:

```ts
type TerminalCustomToolbarAction = {
  id: string
  label: string
  content: string
  pressEnter: boolean
  createdAt: string
  updatedAt: string
  actionRevision: number
}
```

- `label`: required toolbar label, trimmed, at most 32 characters.
- `content`: required single-line terminal input, trimmed, at most 4096 characters.
- `pressEnter`: when enabled, submit a separate carriage return after the text settles; when disabled, only insert text at the cursor.
- The app stores at most 50 user-defined actions and preserves creation order.

Do not model these actions as keyboard shortcut simulation. The app should perform terminal semantics directly:

- Interrupt writes the control character `\x03`.
- Clear calls xterm clear behavior locally.
- Shell launchers write command text plus a newline.

This keeps behavior stable across Electron, browser focus, keyboard layout, and platform differences.

## Built-In Actions

Initial action set:

| Label | Kind | Payload | Availability | Platforms |
| --- | --- | --- | --- | --- |
| `Ctrl+C` | `terminal-sequence` | `\x03` | running session | macOS, Windows, Linux |
| `Clear` | `xterm-local` | `clear` | any session | macOS, Windows, Linux |
| `/exit` | `shell-command` | `/exit` | running session | macOS, Windows, Linux |
| `/clear` | `shell-command` | `/clear` | running session | macOS, Windows, Linux |

Decision notes:

- Keep the visible label `Ctrl+C` on all platforms. Terminal interrupt is conventionally Ctrl+C even on macOS. The app should not label it `Cmd+C`, because Cmd+C means copy in macOS apps and would mislead users.
- Do not add a separate `Stop` button in the first version. `stopSession` is a stronger action than interrupt and can kill the whole pty. It is useful, but too easy to misclick in a dense toolbar.
- Do not add `Clear` as shell text. Local xterm clearing avoids injecting `clear` into a running program and avoids shell-specific differences.
- Do not disable `Clear` for exited/lost sessions. It is a visual buffer operation and remains useful for reading or resetting a stale pane.
- `/exit` and `/clear` submit the shared Claude Code and Codex slash commands without detecting which CLI is active.

## UI Behavior

The toolbar renders only when an active session exists.

Use existing shadcn/Radix button patterns and Tailwind token classes. Do not add custom colors, inline styles, gradients, nested cards, or explanatory copy.

Recommended structure:

```text
dark terminal pane
┌───────────────────────────────────────────────┐
│ xterm                                         │
├───────────────────────────────────────────────┤
│ [Ctrl+C] [Clear] │ [/exit] [/clear]           │
└───────────────────────────────────────────────┘
```

Layout details:

- The toolbar is a single row below xterm.
- Height should be compact and stable.
- The row uses `overflow-x-auto` and `whitespace-nowrap`; actions never wrap.
- Buttons use small or extra-small project button variants.
- Disabled actions stay visible when a session is not running, so users learn what exists.
- No helper copy, marketing copy, or feature explanation is shown.
- Tooltips are optional. If added, they must only name the action, not explain terminal basics.
- User-defined buttons follow the built-ins after a separator. A compact edit icon stays at the far right.
- The edit icon opens `自定义快捷输入`. The dialog lists only user-defined actions and supports add, edit, and delete.
- Add and edit use only `名称`, `输入内容`, and `输入后按回车`; no colors, groups, icons, platforms, or advanced options are introduced.
- Custom write buttons follow running-session availability. The edit icon remains enabled for a lost or exited active session.

Accessibility:

- Each button has an explicit `aria-label`.
- Disabled state reflects action availability.
- Errors from bridge writes use concise toasts.
- The terminal region remains focusable and keeps its current role/label.

## Runtime Behavior

The renderer should retain a ref to the current xterm instance. The existing `useEffect` creates and disposes xterm per active session; the toolbar can call local operations through this ref.

Action execution:

1. Resolve the platform-specific action payload.
2. Check active session and status.
3. For `terminal-sequence`, call `writeSession({ sessionId, data: sequence })`.
4. For `shell-command`, write the command text first, wait for rapid-input detection to settle, then write `\r` as a separate Enter action.
5. For `xterm-local: clear`, call `xterm.clear()` for the active xterm.
6. On failure, log through `createRendererLogger` and show a short toast.

For a user-defined action, write `content` to the active running session. If `pressEnter` is enabled, use the same settled, separate `\r` write as built-in shell commands.

Use `\r` for submitted shell commands because xterm input currently forwards Enter as carriage return from user input. Command text and Enter must use separate writes so child TUIs do not treat the complete sequence as pasted multiline input. Continue to preserve existing chunking helpers if a future action payload could exceed the bridge limit; the initial built-ins are small and do not require chunking.

## Boundaries

- The main Terminal service owns user-defined action CRUD. Renderer access uses narrow, typed UI IPC methods.
- `app.terminal.toolbar-actions` is a dedicated encrypted DataRepository namespace. It never contains built-in actions and does not reuse the standalone Quick Input app's records.
- Safe storage is mandatory; the app must not fall back to plaintext persistence.
- Ordinary configuration backup excludes action labels and contents along with other Terminal bodies.
- No MCP capability update is needed because this is UI configuration over existing terminal input behavior. Existing MCP callers use the current session input tools, and the Terminal tool count remains 43.
- The implementation updates `RELEASE_NOTES_PENDING.md` because the change is user-visible.

## Error Handling

- If there is no active session, the toolbar is not rendered.
- If a running-only action is clicked after the session exits, ignore the click after the disabled check and avoid writing.
- If `writeSession` rejects, log the error and show `写入终端失败`.
- If a local xterm operation is unavailable because the instance has just been disposed, do nothing.
- Shell command failures are visible in terminal output and are not interpreted by Synapse.
- Invalid or multiline custom content is rejected. Create is disabled at the 50-item limit.
- A failed custom-action save or delete keeps the dialog state and shows a concise error.

## Testing

Renderer tests should cover:

- Toolbar appears for an active session.
- Toolbar does not appear in empty state.
- `Ctrl+C` writes `\x03` to the active running session.
- `/exit` and `/clear` write command text, then a separate carriage return after the input-settle delay.
- Running-only buttons are disabled for `lost`, `exited`, `killed`, and `failed` sessions.
- `Clear` remains enabled for non-running sessions and calls the xterm clear method without calling `writeSession`.
- Toolbar row uses horizontal overflow behavior and does not add terminal-pane marketing or helper copy.
- A rejected write logs and shows the existing concise toast.
- Built-ins are absent from the management dialog and cannot be edited or deleted.
- Custom actions create, update, delete, and reload through encrypted persistence.
- Custom actions submit a separate Enter only when `pressEnter` is enabled.
- Custom write actions are disabled for non-running sessions while the management icon remains available.

Manual verification should include:

- Narrow window: toolbar scrolls horizontally instead of wrapping.
- Running shell: `Ctrl+C` interrupts a foreground process.
- Running shell: slash-command buttons submit commands as if typed.
- Exited/lost session: no write actions are available, local clear still works.

## Future Extensions

Possible later additions, outside this implementation:

- Optional per-group action scope if app-global actions prove insufficient.
- A cautious `Stop` action with confirmation or separated danger placement.
- A copy/paste action group if clipboard integration becomes a frequent terminal workflow.
- Platform-specific command variants when real user need appears.
- Optional toolbar visibility setting if users prefer a pure terminal surface.
