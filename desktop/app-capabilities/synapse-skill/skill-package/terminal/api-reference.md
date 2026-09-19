# Terminal MCP API Reference

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` first with the user's intent or the exact `app_*` name, then call `invoke` with the exact name and the `arguments` described by the `inputSchema` that `search` returned. Never guess a name or arguments. In Synapse Agent conversations the same two tools appear as `mcp__synapse-tool-router__search` and `mcp__synapse-tool-router__invoke`.

Terminal MCP currently exposes one development contract. Tool names are the full `app.terminal.<subdomain>.<action>` id with dots replaced by underscores. Requests do not include `contractVersion`, and there are no v1/v2 or legacy aliases to negotiate. Machine logic must use `code`, `category`, `outcome`, revisions, watermarks, and operation ids rather than human messages.

The Terminal UI may group multiple sessions into one split workspace. MCP still addresses each underlying session by `sessionId`; it does not expose or mutate UI workspace, pane, focus, or split-layout state.

## Capability discovery

- `app_terminal_capabilities_get`: local unauthenticated capability discovery for platform, risk, limits, degradation, persistence protection, termination matrix, and raw encoding.
- `app_terminal_diagnostics_get`: bounded diagnostics only for the caller's authorized scope; it never reveals other actors or object usage.
- `app_terminal_global_launch_get`: global Shell, cwd, environment key/action/source metadata, and revision. Environment values are never returned.
- `app_terminal_global_launch_update`: sparse global launch mutation protected by exact revision and `settings.manage`. Unmentioned environment entries remain unchanged; list keys in `settings.inheritEnvironmentKeys` to remove the current-layer entry and restore inheritance. Key matching is case-insensitive on Windows and case-sensitive on macOS/Linux.

`supported` describes the current implementation and platform, not permission to exceed the user's request. If a required capability is degraded or unsupported, use only a documented narrower workflow; never substitute a higher-risk capability merely to bypass the limitation.

## Discovery and details

- `app_terminal_group_list`, `app_terminal_group_get`: minimal group summaries and revisions.
- `app_terminal_group_command_list`: command ids, display names, and revisions without command bodies.
- `app_terminal_session_list`, `app_terminal_session_summary_get`: minimal non-state session summaries.
- `app_terminal_session_state_list`, `app_terminal_session_state_get`: lifecycle, attention evidence, redacted lease occupancy, and state/output watermarks without output bytes.
- `app_terminal_session_metadata_get`: sensitive launch metadata.
- `app_terminal_group_launch_get`: group Shell, cwd, environment key/action/source metadata, and launch revision without environment values.
- `app_terminal_group_command_get`: encrypted saved-command body when separately authorized.

All lists have default and hard maximum limits and opaque cursors bound to their query. Do not reuse a cursor after changing filters. Titles and names are discovery aids only; a sensitive operation always uses a unique id and never guesses among multiple matches.

## Creation

- `app_terminal_session_create`: ordinary UI-equivalent creation. With `groupId`, include exact `expectedLaunchRevision`. It does not accept cwd, shell, environment, or size overrides. The result includes the initial `inputRevision`, `stateRevision`, and output watermark so a known first action does not require a state read.
- `app_terminal_session_override_create`: explicit controlled overrides. Initial dimensions additionally require the resize permission policy.
- `app_terminal_group_command_launch`: only `groupId`, `commandId`, exact launch and command revisions, and idempotency. It accepts no command body or launch override.

Ordinary creation resolves protected Synapse identity, global settings, group settings, and an optional saved-command layer before PTY spawn. Explicit one-time overrides are last. Settings changed afterward do not mutate a running session. A saved-command layer applies to the entire new session, while the saved command body remains the only delivered input sequence.

Saved command bodies normalize CRLF to LF. Empty bodies are rejected, interior empty lines become Enter-only actions, one final LF only terminates the preceding line, and each additional final LF preserves one intentional empty line. Launch writes every logical line as `text` then `Enter`; it is not `shell -c` or a script transaction.

Permission checks, revisions, resolution, and predictable validation complete before identity creation. A PTY failure after identity creation returns `failed_after_identity_created` with the new `sessionId`, then automatically removes the failed session and workspace. The id is diagnostic only and later reads return `not_found`.

## Observation and output

- `app_terminal_session_observe`: bounded state/output-watermark wait, no output bytes.
- `app_terminal_session_output_read`: bounded non-waiting raw PTY range.
- `app_terminal_session_output_observe`: state snapshot plus bounded raw output; requires state and output permissions.
- `app_terminal_session_view_get`: bounded headless-emulator screen or scrollback view with `throughOutputSeq`, size revision, emulator version, and degradation reasons.

Maintain `afterStateRevision` and `afterOutputSeq` independently. A normal timeout returns `changed:false`. A retention gap returns immediately with the current available interval and recovery position.

`attention` is the session's "is a person needed right now" fact and is part of `app_terminal_session_state_get`, `app_terminal_session_state_list`, and every observe result. Synapse writes `waiting` with `kind` `approval` or `agent_question` when the Codex or Claude Code hooks injected by the Terminal agent-notification setting report a permission request, a question tool, or an action notification, and returns to `not_waiting` when the prompt is submitted, the tool continues, the agent is interrupted, the session ends, or the user types in the terminal themselves. `unknown` means no evidence; it is not the same as `not_waiting`. Treat `waiting` as evidence that the agent is blocked on a person: read the rendered view to see the actual question, report it, and get explicit user judgment before answering approvals, passwords, or destructive choices. Do not treat it as a durable state — it clears as soon as work resumes.

`tty` is the session's PTY device (for example `/dev/ttys036`), and `agent` is the run state of the agent inside it. Both are part of `app_terminal_session_state_get`, `app_terminal_session_state_list`, and every observe result.

- `tty` is the one handle the kernel guarantees: the device name is fixed for the PTY's lifetime and a process's controlling terminal is a live fact, so `ps -t <tty>` finds whatever is running inside that terminal. It is absent on platforms without such a device. Use it when a user pastes a Terminal reference and asks you to find the Claude Code session occupying that terminal — not by guessing from titles.
- `agent` is the archived run state: `state` is one of `idle` / `working` / `needs_input` / `ended` (`launching` never appears), with `agentKind`, a monotonic `version`, and two timestamps. It carries no prompt, answer, output, or tool-argument text. An absent `agent` means no agent ever ran in this session, or the Terminal agent-notification setting is off — that is **not** the same as `state: "ended"`, which means one ran and has exited. Decide accordingly: absent means "nothing to continue here", `ended` means "there is a conversation to resume". Compare `version` to tell whether anything changed; the block never wakes an observe.

## Control and input

- `app_terminal_session_control_acquire`: immediately acquire one short-lived writer lease for a running session, bound to trusted client and controller instance context. The result includes the current `inputRevision` for the next input request.
- `app_terminal_session_control_renew`: explicitly renew a still-valid lease held by the same trusted controller instance. Its result refreshes the current `inputRevision`; use it directly rather than adding a state read.
- `app_terminal_session_control_release`: idempotently release the current owner's lease without affecting a newer lease revision.
- `app_terminal_session_input_send`: ordered `text` and fixed `key` actions.
- `app_terminal_session_input_command`: one control-free line followed by server-generated Enter.
- `app_terminal_session_input_paste`: bounded UTF-8 bracketed paste with fresh mode evidence and no fallback.
- `app_terminal_session_input_raw`: one canonical Base64 payload; requires control and raw-input permissions.
- `app_terminal_session_resize`: exact expected size revision plus current lease and resize/control permissions.

Input and resize require caller-scoped idempotency keys. A fresh descriptive literal that identifies the current task, action, and sequence is sufficient; do not invoke helper code or another tool only to generate randomness. Same key and canonical request returns the stored result during the retention window while its session exists; a changed request conflicts. Automatic session cleanup removes session-scoped idempotency, so a later retry is a new decision and creation uses a new identity. Outside that window, inspect current revisions and decide again rather than replaying blindly.

An accepted input result proves only that Synapse delivered bytes to the PTY. Before reporting that an interactive foreground program submitted the instruction or started work, observe fresh output or a rendered view. If the complete instruction remains in the input area, send one Enter key and observe again without resending the text.

## Session navigation

- `app_terminal_session_open`: open or focus one existing local session in the Synapse Terminal window. Pass an immutable `sessionId` already returned by another Terminal tool; when the user pastes a Terminal reference, use its `session_id` line.

A Terminal reference copied from the sidebar, a tab menu, or a pane header is plain text with one `key=value` per line: `workspace_id`, `session_ref`, and `session_id`. `session_id` addresses the session and `workspace_id` addresses the tab that holds it (see Tabs below); the checksummed `session_ref` is context for a person and no tool accepts it. The result contains the resolved `sessionId` and nothing else: no output, no screen content, and no metadata. Sessions live only for the current Synapse run, so a reference stops resolving after its session ends or Synapse restarts; opening a stale one fails without creating or restarting a session. Never substitute a create call for a session that no longer resolves.

## Tabs

A tab is the sidebar row that holds one or more sessions side by side. It has no stable reference of its own beyond `workspaceId`, and its layout tree and pane ids appear in no request or response — a tab is reported only as an id, a title, and the sessions it holds.

- `app_terminal_workspace_list`: bounded tab summaries, each with the `sessionIds` it holds in layout order (left to right, top to bottom), optionally filtered by `groupId`. Pagination: cursor-based. Continue with `nextCursor`.
- `app_terminal_workspace_get`: one tab summary by immutable `workspaceId`.
- `app_terminal_workspace_pane_create`: create a pane beside an existing one, inside the tab that holds it. Address the pane by the `sessionId` it runs — a pane and a session are one to one, so no pane id is ever needed — and pass the tab's current `expectedLayoutRevision`. `direction` is `right` or `down`; optional `cols` / `rows` set the new session's initial size.
- `app_terminal_workspace_rename`: rename a tab under its layout revision. A tab holding a single session already follows that session's own rename, so this is only needed when the two must differ.
- `app_terminal_workspace_delete`: delete a tab by normally stopping every session it holds. There is no force option and nothing escalates; a tab whose sessions are still stopping returns `state: "closing"` with its `remainingSessionIds` rather than waiting.

`workspace.delete` is the tab-level form of `session.stop`, not a shortcut around it: every member goes through normal termination. It ends work in progress in every pane of that tab at once, so confirm with the user before using it on a tab whose members are running.

## Lifecycle and deletion

- `app_terminal_session_stop`: normal termination, running only.
- `app_terminal_session_force_stop`: explicit higher-risk force operation where the platform proves a distinct path.
- `app_terminal_operation_get`: redacted operation status; pass both `sessionId` and `operationId` so state permission is checked on the original session before operation lookup.
- `app_terminal_session_delete`: compatibility cleanup for a terminal-state session that is still observable during its final transition; normal termination already deletes the session.
- `app_terminal_group_delete`: empty group only with exact group revision.
- `app_terminal_group_delete_preview`, `app_terminal_group_delete_commit`: bounded plan and unchanged-plan commit for nonempty groups whose sessions are all terminal.

Termination operations progress independently through `pending_delivery`, `delivered`, `delivery_uncertain`, `completed`, or `failed`. Session lifecycle remains `running`, `stopping`, `ended`, `failed`, or `lost` and is the authoritative runtime fact while the object exists. `ended`, `failed`, and `lost` wake pending observers and then trigger automatic deletion of the session, operation, output, checkpoint, pane, and empty workspace. Treat a subsequent `not_found` as completed cleanup. Synapse shutdown removes every session; restart does not restore old terminals.

## Management

- Global launch: `app_terminal_global_launch_get` and `app_terminal_global_launch_update`.
- Groups: `app_terminal_group_create`, `app_terminal_group_rename`, `app_terminal_group_launch_update`, and `app_terminal_group_delete`.
- Commands: `app_terminal_group_command_create`, `app_terminal_group_command_update`, and `app_terminal_group_command_delete`.
- Sessions: `app_terminal_session_metadata_rename` and `app_terminal_session_resize`.

Use the exact revision named by each schema. Group metadata, launch settings, membership, command collection, individual commands, session metadata, state, input, size, and output have separate revisions or watermarks; conflicts never auto-merge.

## Stable safety semantics

Permission checks precede sensitive existence checks. An unauthorized request receives `permission_denied` without confirming whether the id exists. Invalid protected, duplicate, or oversized launch environment settings return `validation_error` after authorization. Errors, audit, and launch-setting MCP responses never contain environment values, input, output, command bodies, credentials, absolute paths, raw Base64, control sequences, or plaintext lease ids. Ordinary configuration backup excludes terminal environment bodies, output, checkpoints, command bodies, active leases, and short-lived idempotency state.

Treat a rejection before side effects as an error. Once identity creation, byte acceptance, or platform delivery may have occurred, use the returned `outcome`, ids, revisions, and acceptance boundary to decide what is safe next. `accepted`, `partial`, `delivery_uncertain`, `no_op`, and `failed_after_identity_created` are not interchangeable. In particular, never automatically replay `partial` or `delivery_uncertain`, even when `retryable` is true; inspect the current facts and ask the user when the next action could duplicate or escalate a side effect.

On `permission_denied`, report that a local policy blocked the operation without claiming whether the target exists. Local Terminal MCP does not require a login or Terminal grant, so do not instruct the user to authenticate or authorize it. Do not retry through raw input, a broader metadata read, or another object's scope.

Use only tools present in the current catalog. Removed names such as `app_terminal_group_update_settings`, `app_terminal_session_get`, `app_terminal_session_read`, `app_terminal_session_rename`, and `app_terminal_session_write` are not compatibility fallbacks. Their current replacements are `app_terminal_group_launch_update`, `app_terminal_session_state_get`, `app_terminal_session_output_read`, `app_terminal_session_metadata_rename`, and the appropriate semantic input tool.
