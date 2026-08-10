# Terminal MCP API Reference

Terminal MCP currently exposes one development contract. Tool names are the full `app.terminal.<subdomain>.<action>` id with dots replaced by underscores. Requests do not include `contractVersion`, and there are no v1/v2 or legacy aliases to negotiate. Machine logic must use `code`, `category`, `outcome`, revisions, watermarks, and operation ids rather than human messages.

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

Permission checks, revisions, resolution, and predictable validation complete before identity creation. A PTY failure after identity creation returns `failed_after_identity_created` with the new `sessionId`.

## Observation and output

- `app_terminal_session_observe`: bounded state/output-watermark wait, no output bytes.
- `app_terminal_session_output_read`: bounded non-waiting raw PTY range.
- `app_terminal_session_output_observe`: state snapshot plus bounded raw output; requires state and output permissions.
- `app_terminal_session_view_get`: bounded headless-emulator screen or scrollback view with `throughOutputSeq`, size revision, emulator version, and degradation reasons.

Maintain `afterStateRevision` and `afterOutputSeq` independently. A normal timeout returns `changed:false`. A retention gap returns immediately with the current available interval and recovery position.

## Control and input

- `app_terminal_session_control_acquire`: immediately acquire one short-lived writer lease for a running session, bound to trusted client and controller instance context. The result includes the current `inputRevision` for the next input request.
- `app_terminal_session_control_renew`: explicitly renew a still-valid lease held by the same trusted controller instance. Its result refreshes the current `inputRevision`; use it directly rather than adding a state read.
- `app_terminal_session_control_release`: idempotently release the current owner's lease without affecting a newer lease revision.
- `app_terminal_session_input_send`: ordered `text` and fixed `key` actions.
- `app_terminal_session_input_command`: one control-free line followed by server-generated Enter.
- `app_terminal_session_input_paste`: bounded UTF-8 bracketed paste with fresh mode evidence and no fallback.
- `app_terminal_session_input_raw`: one canonical Base64 payload; requires control and raw-input permissions.
- `app_terminal_session_resize`: exact expected size revision plus current lease and resize/control permissions.

Input and resize require caller-scoped idempotency keys. A fresh descriptive literal that identifies the current task, action, and sequence is sufficient; do not invoke helper code or another tool only to generate randomness. Same key and canonical request returns the stored result during the retention window; a changed request conflicts. Outside that window, inspect current revisions and decide again rather than replaying blindly.

An accepted input result proves only that Synapse delivered bytes to the PTY. Before reporting that an interactive foreground program submitted the instruction or started work, observe fresh output or a rendered view. If the complete instruction remains in the input area, send one Enter key and observe again without resending the text.

## Lifecycle and deletion

- `app_terminal_session_stop`: normal termination, running only.
- `app_terminal_session_force_stop`: explicit higher-risk force operation where the platform proves a distinct path.
- `app_terminal_operation_get`: redacted operation status; pass both `sessionId` and `operationId` so state permission is checked on the original session before operation lookup.
- `app_terminal_session_delete`: terminal-state session only.
- `app_terminal_group_delete`: empty group only with exact group revision.
- `app_terminal_group_delete_preview`, `app_terminal_group_delete_commit`: bounded plan and unchanged-plan commit for nonempty groups whose sessions are all terminal.

Termination operations progress independently through `pending_delivery`, `delivered`, `delivery_uncertain`, `completed`, or `failed`. Session lifecycle remains `running`, `stopping`, `ended`, `failed`, or `lost` and is the authoritative runtime fact.

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
