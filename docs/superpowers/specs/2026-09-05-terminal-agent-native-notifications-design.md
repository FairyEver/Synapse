# Terminal Agent Native Notifications Design

## Goal

When an interactive Codex or Claude Code process in Synapse Terminal needs user action or finishes its top-level task, Synapse may show a native desktop notification. Clicking it focuses Synapse and opens the exact Terminal session, workspace, and pane identified by the immutable `sessionId`.

This is a Terminal-owned interactive notification feature. It is not a notification center, history, delivery queue, MCP tool, Workflow node, Deep Link, or extension of System Notifier.

## Opt-in and launch boundary

The setting is off by default, stored in `app.terminal.agent-notification-settings`, exposed only in Terminal's global settings, and applies only to newly created PTYs.

When enabled, Terminal prepends a private shim directory to the session PATH and re-prepends it after supported local shell profiles load. The shims wrap only session-starting invocations of `codex` and `claude`, find the real executable outside the shim directory, and preserve arguments, stdio, exit code, and signals. Aliases and shell functions such as `CX=codex` or `CC=claude` work when their final command lookup uses PATH.

Absolute executable paths, remote shells, containers, `env -i`, later explicit PATH replacement, and commands launched with `SYNAPSE_AGENT_NOTIFICATIONS_DISABLED=1` are outside the integration guarantee. Failure to prepare the runtime or loopback listener must leave ordinary Terminal sessions usable.

## Agent adapters

Codex receives command Hooks through per-process configuration for session start, prompt submission, tool use, permission requests, stop, interrupt, and session end. Synapse never bypasses Codex Hook trust; the user must approve the stable Synapse Hook command when Codex asks.

Claude Code receives a temporary merged settings file containing equivalent Hooks, including notification and subagent events. Existing `--settings` JSON or files are deep-merged and user Hook arrays are preserved. If settings cannot be read or merged, Claude Code starts with the original arguments and Synapse skips notification Hooks for that process.

OSC 9, 99, and 777 remain a generic completion fallback. Hook and OSC events for the same session and state are deduplicated.

## Private event ingress

The main process owns one ephemeral loopback HTTP listener registered through `NetworkServiceRegistry`. Each Terminal session receives a random bearer token bound server-side to its immutable `sessionId`. Requests must be loopback, use the exact path, stay within the body and rate limits, and match both token and session.

Hook helpers may report only provider, event name, session id, tool name, notification type, and subagent identity fields. Prompt text, answers, tool arguments, terminal output, working directories, environment values, and transcripts must not cross this ingress or appear in logs, audit records, notifications, or persisted settings.

Filesystem writes, listener creation, and notification triggering pass through `PermissionGuard` and `AuditSink`. Runtime helpers contain no credential and are stored under Terminal's user-data directory with restrictive permissions.

## Notification policy

Top-level permission requests and question/plan-exit tools map to “需要你的操作”. A top-level stop maps to “任务已完成”. Subagent events are ignored. New user input clears waiting state.

The notification contains only the Agent product name, sanitized session title, and mapped status. It is suppressed only when the exact session is active in the currently focused renderer. Otherwise it always uses the native notification adapter, including when another Synapse window, System App, or pane is focused. The native notification object remains alive until close or click.

On click, Synapse focuses the app and sends the existing Terminal System App open request containing only a new request id and the target `sessionId`. The renderer resolves the owning workspace and pane, selects them, and focuses the terminal. No notification action is routed through System Notifier.

## Supported shells and platforms

The integration is implemented for zsh, bash, fish, PowerShell, and cmd on Synapse's supported desktop platforms. Unknown shells receive only the initial PATH prepend. Platform support must be validated with unit or integration tests for wrapper resolution, argument preservation, settings merge, and exact-session navigation before release.
