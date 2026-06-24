# Synapse Terminal App Design

## Summary

Synapse will add a system app named `终端`. It provides real interactive terminal sessions inside Synapse and exposes those sessions through `synapse-mcp` so other agents can create sessions, inspect state, read output, and write input to authorized sessions.

The first version uses Synapse-managed background terminal sessions. Terminal processes live in the Electron Main Process and are not tied to the terminal app window. Closing the terminal app or the main window while the Electron process remains alive does not stop running sessions. Fully quitting Synapse does not preserve live processes; on the next launch, previously running sessions are restored as historical records with a `lost` status.

## Goals

- Let users open and use real shell terminals inside Synapse.
- Let other agents control Synapse terminal sessions through MCP.
- Keep terminal runtime state in Electron Main, not Renderer.
- Support cmux-like grouping: each group contains multiple sessions.
- Persist groups, session metadata, and bounded output history.
- Let the UI close and reopen without interrupting running terminal tasks while Synapse is still running.
- Keep the design ready for future grouped split panes without implementing split panes now.

## Non-Goals

- No split panes in the first version.
- No SSH connection manager.
- No AI command execution API such as `runCommand(command)`.
- No complete process restoration after Synapse fully exits or the computer restarts.
- No arbitrary shell selection in the first version.
- No terminal command audit system beyond the minimal write/stop permission and audit records.

## Architecture

The terminal feature is implemented as an App Capability Package:

```text
desktop/app-capabilities/terminal/
  shared/
    capability.ts
    schema.ts
    manifest.ts
  main/
    service.ts
    store.ts
    output-buffer.ts
    ipc.ts
    dispatcher.ts
  renderer/
    app-manifest.ts
    app-definition.ts
    index.tsx
```

`TerminalService` is the only owner of real terminal processes. It runs in Electron Main and keeps a runtime map:

```ts
Map<string, TerminalSessionRuntime>
```

Each runtime owns one `node-pty` process, session metadata, output sequence state, an in-memory ring buffer, and subscriber lists for UI events.

Renderer and MCP never create or manage pty processes directly:

```text
Terminal App UI
  -> preload bridge / IPC
  -> TerminalService
  -> node-pty

synapse-mcp
  -> app terminal capability dispatcher
  -> TerminalService
  -> node-pty
```

This keeps UI, MCP, and future workflow entry points aligned around one service boundary.

## Shell Behavior

The first version supports only the user's default shell, matching the behavior a user expects when opening Terminal or iTerm on macOS.

Shell resolution happens in Main:

- macOS/Linux: use `process.env.SHELL` when available, then fall back to common system shells.
- Windows: use `process.env.ComSpec` or the platform default.

MCP and Renderer cannot pass an arbitrary shell executable in the first version. A future version may add shell profiles with explicit user configuration and validation.

`node-pty` must be imported with:

```ts
import * as pty from "node-pty"
```

Renderer must not import `node-pty`.

## Data Model

### TerminalGroup

```ts
type TerminalGroup = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  sortOrder: number
}
```

### TerminalSession

```ts
type TerminalSession = {
  id: string
  groupId: string
  title: string
  cwd: string
  shell: string
  status: "running" | "exited" | "killed" | "failed" | "lost"
  exitCode?: number
  signal?: number
  createdAt: string
  updatedAt: string
  startedAt: string
  endedAt?: string
  cols: number
  rows: number
  lastOutputSeq: number
}
```

### TerminalOutputChunk

```ts
type TerminalOutputChunk = {
  sessionId: string
  seq: number
  data: string
  createdAt: string
  source: "pty"
}
```

## Persistence

Group and session metadata are persisted. Output history is persisted with a bounded per-session size.

The default output retention limit is 10 MB per session. This limit must be configurable through a desktop configuration constant rather than hard-coded inside the service. Any new constant in `desktop/config.ts` must include a Chinese comment explaining its purpose and impact.

When output exceeds the configured retention limit:

- Old chunks are pruned.
- Reads that start before the retained window return `truncated: true`.
- The response includes the first retained sequence so callers can reset their cursor.

On Synapse startup:

- Existing groups and sessions are loaded.
- Sessions previously marked `running` are changed to `lost`.
- No attempt is made to recreate the old process.

## Lifecycle

### Service Lifecycle

`TerminalService` starts with Electron Main and restores persisted state. It owns all live pty processes until Synapse exits or a session is stopped.

### Session Lifecycle

- `create`: create metadata, spawn default shell pty, initialize output sequence.
- `attach`: read retained output and subscribe to future output.
- `write`: write raw input data to pty after permission checks.
- `resize`: update cols/rows and call `pty.resize`.
- `stop`: terminate the pty and update session status.
- `onExit`: record exit code or signal, update status, broadcast state changes.

### UI Lifecycle

- Opening the terminal app lists groups and sessions.
- The app selects the most recent running session when available.
- Switching sessions disposes the current xterm listeners and attaches to the new session.
- Closing the app only unsubscribes Renderer listeners.
- Closing the main window while Synapse remains alive does not kill terminal sessions.

## MCP Capabilities

The first version exposes terminal resources through the `app` capability domain.

Recommended tools:

```text
app_terminal_group_create
app_terminal_group_list
app_terminal_session_create
app_terminal_session_list
app_terminal_session_get
app_terminal_session_read
app_terminal_session_write
app_terminal_session_resize
app_terminal_session_stop
```

`session_write` writes raw terminal input. It does not append newlines, wrap shell commands, or provide a separate command execution interface.

Representative schemas:

```ts
type CreateSessionInput = {
  groupId?: string
  title?: string
  cwd?: string
  cols?: number
  rows?: number
}

type ReadSessionInput = {
  sessionId: string
  afterSeq?: number
  limitBytes?: number
}

type WriteSessionInput = {
  sessionId: string
  data: string
}

type StopSessionInput = {
  sessionId: string
  force?: boolean
}
```

The capability action allowlist should add `write` and `stop` so terminal capability ids can use natural names:

```text
app.terminal.session.write
app.terminal.session.stop
```

## Permissions and Audit

MCP can create, list, get, read, and resize terminal sessions through normal capability dispatch.

MCP write and stop are sensitive:

- `session_write` is allowed for any running Synapse terminal session.
- `session_stop` is allowed for any running Synapse terminal session.
- Both actions must pass through the existing `shell.exec` permission and audit boundary.

Audit records for write and stop include actor, source, session id, byte count, timestamp, and outcome. Audit records must not store the full input data, because terminal input may contain secrets.

## Renderer UI

The terminal is a Synapse system app registered alongside the other system apps.

Layout:

- Left side: groups and sessions.
- Center: current xterm terminal.
- Top area: current session title, status, cwd, create and stop actions.
- No right panel in the first version.

Empty states stay minimal:

- No sessions: `新建终端`
- Empty group: `新建会话`
- Lost session: show status and allow creating a new session.

Renderer uses:

```ts
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import "@xterm/xterm/css/xterm.css"
```

The UI uses existing Synapse and shadcn components such as `SystemAppWindowShell`, `Button`, `Switch`, `Badge`, and `ScrollArea`. It must not introduce custom colors, hex/rgb/hsl literals, decorative gradients, nested cards, or explanatory product copy.

## IPC and Preload

Preload exposes a minimal terminal bridge under the existing Synapse bridge namespace. It must not expose `ipcRenderer`.

Renderer APIs should return cleanup functions for subscriptions:

```ts
terminal.onData(sessionId, callback): () => void
terminal.onSessionChanged(callback): () => void
```

Unmounting the terminal view must:

- Remove IPC listeners.
- Dispose xterm listeners.
- Disconnect `ResizeObserver`.
- Dispose the xterm instance.
- Not stop the pty session unless the user explicitly stops it.

## Packaging

Dependencies:

```text
@xterm/xterm
@xterm/addon-fit
@xterm/addon-web-links
node-pty
```

`node-pty` is a native module, so implementation must verify Electron rebuild and packaged app behavior. If packaging boundaries change, the packaged asar check must prove the native runtime files are available in the correct packed or unpacked location.

## Validation

Core tests:

- Renderer cannot import `node-pty`.
- Preload does not expose raw `ipcRenderer`.
- Creating a session spawns a default shell.
- Multiple sessions do not mix output.
- Output is sequenced and can be read with `afterSeq`.
- Output beyond the configured limit returns `truncated: true`.
- UI detach does not stop the pty.
- Reopening the UI can read output produced while detached.
- MCP can write to running sessions after permission approval.
- MCP can stop running sessions after permission approval.
- Restarting Synapse marks old running sessions as `lost`.
- Stop prevents later write and resize operations.

Manual checks:

- App starts.
- Terminal prompt appears.
- macOS commands work: `pwd`, `ls`, `echo hello`, `node -v`, `npm -v`.
- Resize changes pty dimensions.
- Closing and reopening the terminal app preserves live output while Synapse remains running.
- DevTools has no terminal bridge errors.

## Future Extensions

- Split panes inside a group.
- Named shell profiles with user-approved executables.
- Workflow node support for starting or attaching to terminal sessions.
- Session sharing controls per MCP actor.
- Richer terminal diagnostics and resource limits.
- Optional external tmux/cmux adapter for users who want process survival after full Synapse exit.
