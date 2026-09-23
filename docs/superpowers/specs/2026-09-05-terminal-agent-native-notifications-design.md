# Terminal Agent Native Notifications Design

## Goal

When an interactive Codex or Claude Code process in Synapse Terminal needs user action or finishes its top-level task, Synapse may show a native desktop notification. Clicking it focuses Synapse and opens the exact Terminal session, workspace, and pane identified by the immutable `sessionId`.

This is a Terminal-owned interactive notification feature. It is not a notification center, history, delivery queue, MCP tool, Workflow node, Deep Link, or extension of System Notifier.

## Opt-in and launch boundary

The settings are off by default, stored in `app.terminal.agent-notification-settings`, exposed only in Terminal's global settings, and apply only to newly created PTYs.

The single opt-in carries two switches. `enabled` is the injection boundary described below. `notify` only decides whether a mapped event raises a native notification; with it off, the session archive, the waiting-input attention state, and everything the sidebar, mobile, and MCP read from them stay exactly as they were. Splitting them changes no injection boundary — a session with notifications on and `notify` off is injected exactly like one that also pops. Records written before this split are upgraded on read with `notify: true`, which is what "the switch is on" used to mean.

When enabled, Terminal prepends a private shim directory to the session PATH and re-prepends it after supported local shell profiles load. The shims wrap only session-starting invocations of `codex` and `claude`, find the real executable outside the shim directory, and preserve arguments, stdio, exit code, and signals. Aliases and shell functions such as `CX=codex` or `CC=claude` work when their final command lookup uses PATH.

Absolute executable paths, remote shells, containers, `env -i`, later explicit PATH replacement, and commands launched with `SYNAPSE_AGENT_NOTIFICATIONS_DISABLED=1` are outside the integration guarantee. The shim is not the only door: Synapse's own Claude Code launches are absolute paths and therefore outside the shim guarantee by construction, so they are served through the launcher's own settings file instead — the same hooks, written by the launcher (see Agent adapters). Failure to prepare the runtime or loopback listener must leave ordinary Terminal sessions usable.

## Agent adapters

Codex receives command Hooks through per-process configuration for session start, prompt submission, tool use, permission requests, stop, interrupt, and session end. Synapse never bypasses Codex Hook trust; the user must approve the stable Synapse Hook command when Codex asks.

The Hook feature is switched on with `-c features.hooks=true` rather than the equivalent-looking `--enable hooks`. Codex validates `--enable` against its feature list and refuses to start (exit 1, `Unknown feature flag`) on a name it does not know, so a renamed or removed feature would take the user's own `codex` command down with it — `plugin_hooks` has already been removed from that list once. `-c` is a raw configuration override, tolerated when the key is unknown, and Codex documents the two as equivalent. Keep the `-c` form.

Claude Code receives a temporary merged settings file containing equivalent Hooks, including notification and subagent events. Existing `--settings` JSON or files are deep-merged and user Hook arrays are preserved. If settings cannot be read or merged, Claude Code starts with the original arguments and Synapse skips notification Hooks for that process.

That merge happens in the wrapper, which only runs for a hand-typed `claude`. A Claude Code session Synapse starts itself (new conversation, ⌘-click on a project group, mobile) launches the bundled runtime by absolute path and never touches the shim, so the launcher writes the same Hooks into the settings file it already generates for that session, under the same `__synapse` marker. Both writers must produce byte-identical Hooks — the event list has one definition, and a test compares the wrapper's merged output against the launcher's settings directly. The launcher's injection is gated by the same master switch and, when the notification service cannot be resolved, the session starts without Hooks rather than not at all. `SYNAPSE_AGENT_NOTIFICATIONS_DISABLED` stays a shim-path affordance: the launcher decides before the session's resolved environment exists, so the setting is the control for that path.

OSC 9, 99, and 777 remain a generic completion fallback, and "fallback" is meant literally: a session whose agent has reported through its own Hooks has a primary channel, so its OSC completions are ignored outright. This is what keeps an unrelated OSC sequence in the terminal (a progress convention, say) from raising a completion for an agent that never signalled one. Hook and OSC events for the same session and state are additionally deduplicated within a short window, keyed by session and kind.

## Private event ingress

The main process owns one ephemeral loopback HTTP listener registered through `NetworkServiceRegistry`. Each Terminal session receives a random bearer token bound server-side to its immutable `sessionId`. Requests must be loopback, use the exact path, stay within the body and rate limits, and match both token and session.

Hook helpers may report only provider, event name, session id, tool name, notification type, and subagent identity fields. Prompt text, answers, tool arguments, terminal output, working directories, environment values, and transcripts must not cross this ingress or appear in logs, audit records, notifications, or persisted settings.

The bearer token is a session capability, not a secret to be hidden. It exists because the listener is loopback-reachable by anything on the machine, including a browser page, and because events must not be forgeable across sessions; the token is bound server-side to exactly one `sessionId`. It is deliberately not a boundary against processes in the same terminal's process tree running as the same user — those can already do far worse than forge a notification, so moving the token out of the environment buys nothing and is not a goal.

Filesystem writes, listener creation, and notification triggering pass through `PermissionGuard` and `AuditSink`. Runtime helpers contain no credential and are stored under Terminal's user-data directory with restrictive permissions.

## Notification policy

Top-level permission requests and question/plan-exit tools map to “需要你的操作”. A top-level stop maps to “任务已完成”. An idle prompt — the agent reporting that it finished and has been waiting on you since — maps to its own wording, “还在等你”: it arrives after the completion notification, and sharing that sentence would read as the same notification firing twice. Subagent events are ignored. New user input clears waiting state.

The notification contains only the Agent product name, sanitized session title, and mapped status. It is suppressed only when the exact session is active in the currently focused renderer. Otherwise it always uses the native notification adapter, including when another Synapse window, System App, or pane is focused. The native notification object remains alive until close or click.

On click, Synapse focuses the app and sends the existing Terminal System App open request containing only a new request id and the target `sessionId`. The renderer resolves the owning workspace and pane, selects them, and focuses the terminal. No notification action is routed through System Notifier.

## Supported shells and platforms

The integration is implemented for zsh, bash, fish, PowerShell, and cmd on Synapse's supported desktop platforms. zsh startup files are redirected through `ZDOTDIR` and relayed back to the user's own files, including the login-shell-only ones (`zprofile`, `zlogin`, and `zlogout`); only the prompt-time OSC 7 hook is skipped for `zlogout`, which reports nothing on exit but must still run the user's own teardown. Unknown shells receive only the initial PATH prepend. Platform support must be validated with unit or integration tests for wrapper resolution, argument preservation, settings merge, and exact-session navigation before release.
