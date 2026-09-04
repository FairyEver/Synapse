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

Add a very small toolbar at the top of the active terminal pane, inside the dark terminal area and above xterm.

```text
┌──────────────────┬─────────────────────────────────────────┐
│ Terminal groups  │ Ctrl+C  Clear  │  /exit  /clear │
│                  ├─────────────────────────────────────────┤
│ zsh              │                                         │
│ dev              │                 xterm                   │
│                  │                                         │
└──────────────────┴─────────────────────────────────────────┘
```

Reasons:

- Top placement avoids fighting the shell prompt and the latest output line.
- The toolbar belongs to the active terminal pane, not the global app shell.
- Users can discover actions before focusing the terminal.
- A fixed-height top row is easier to keep stable than a bottom overlay.
- The toolbar can horizontally scroll on narrow screens without wrapping.

The first version should ship only built-in toolbar actions defined in code. Do not add user customization, storage schema, command management UI, or MCP tools for toolbar actions yet.

Reasons:

- The current request is for common, global operations.
- Existing group commands already cover user-defined project commands, but they intentionally create new sessions.
- Adding persistent custom toolbar actions would require schema, IPC, migration, settings UI, and MCP documentation before the core interaction has been validated.
- A code-level registry still gives a clean extension point for future customization.

## Action Model

Represent each button as a registry item. The registry is renderer-owned in the first version because all initial actions can be implemented with existing renderer state, xterm APIs, and current bridge methods.

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
│ [Ctrl+C] [Clear] │ [/exit] [/clear] │
├───────────────────────────────────────────────┤
│ xterm                                         │
└───────────────────────────────────────────────┘
```

Layout details:

- The toolbar is a single row above xterm.
- Height should be compact and stable.
- The row uses `overflow-x-auto` and `whitespace-nowrap`; actions never wrap.
- Buttons use small or extra-small project button variants.
- Disabled actions stay visible when a session is not running, so users learn what exists.
- No helper copy, marketing copy, or feature explanation is shown.
- Tooltips are optional. If added, they must only name the action, not explain terminal basics.

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

Use `\r` for submitted shell commands because xterm input currently forwards Enter as carriage return from user input. Command text and Enter must use separate writes so child TUIs do not treat the complete sequence as pasted multiline input. Continue to preserve existing chunking helpers if a future action payload could exceed the bridge limit; the initial built-ins are small and do not require chunking.

## Boundaries

No new main-process service method is needed for the first version.

No shared schema changes are needed.

No DataRepository namespace is needed.

No MCP capability update is needed because the toolbar is a renderer convenience over existing terminal write behavior. Existing MCP callers can already write raw input or stop sessions through current terminal tools.

No release-note entry is needed for this Spike alone. The implementation should update `RELEASE_NOTES_PENDING.md` because the toolbar is a user-facing terminal improvement.

## Error Handling

- If there is no active session, the toolbar is not rendered.
- If a running-only action is clicked after the session exits, ignore the click after the disabled check and avoid writing.
- If `writeSession` rejects, log the error and show `写入终端失败`.
- If a local xterm operation is unavailable because the instance has just been disposed, do nothing.
- Shell command failures are visible in terminal output and are not interpreted by Synapse.

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

Manual verification should include:

- Narrow window: toolbar scrolls horizontally instead of wrapping.
- Running shell: `Ctrl+C` interrupts a foreground process.
- Running shell: slash-command buttons submit commands as if typed.
- Exited/lost session: no write actions are available, local clear still works.

## Future Extensions

Possible later additions, outside this first implementation:

- User-defined toolbar actions stored per app or per group.
- A cautious `Stop` action with confirmation or separated danger placement.
- A copy/paste action group if clipboard integration becomes a frequent terminal workflow.
- Platform-specific command variants when real user need appears.
- Optional toolbar visibility setting if users prefer a pure terminal surface.
