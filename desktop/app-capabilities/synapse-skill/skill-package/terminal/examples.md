# Terminal MCP Task Patterns

Use these patterns to translate natural-language requests into the current Terminal tools. They describe call order and decision points; construct every request from the live tool schema and the revisions returned by earlier calls. Do not add a `contractVersion` field or look for versioned/legacy aliases.

## Create an ordinary session and run one command

Example request: "Open a new Synapse terminal, run the desktop tests, and tell me the result."

1. When support facts are not already known, call `app_terminal_capabilities_get` once and verify the required create, state, output, and control capabilities are supported.
2. Call `app_terminal_session_create` without `groupId` or launch overrides. Use a fresh caller-scoped descriptive idempotency key directly in the request and retain the returned `sessionId`; do not run helper code merely to generate the key.
3. Because this session was just created and the first command is already known, do not add a state or screen read. Acquire a short lease with `app_terminal_session_control_acquire` and use the returned input revision.
4. Call `app_terminal_session_input_command` with the one-line command, current lease, exact input revision, and a new idempotency key.
5. Follow state and output with `app_terminal_session_output_observe`, maintaining the state and output cursors independently. If output permission is absent, state observation alone cannot prove command output.
6. Release the lease when no further input is needed. Report only completion facts supported by lifecycle, attention, or output evidence, and reconstruct the reported action order from the completed tool trace rather than the planned steps.

Do not use session overrides merely to choose a working directory. If the user needs a specific cwd, shell, environment, or initial size, explain that this is an explicit higher-risk override path and use `app_terminal_session_override_create` only when the request requires it.

## Create inside a named group

Example request: "Create a terminal in the Frontend group and run the dev server."

1. Use `app_terminal_group_list` to resolve the name to one `groupId`. Do not choose when multiple groups match.
2. Preserve the group's current `launchRevision` from the group result.
3. Call `app_terminal_session_create` with that `groupId` and exact `expectedLaunchRevision`. Do not add cwd, shell, environment, or size overrides.
4. Acquire control, submit the single-line start command, and observe bounded output until startup is supported by evidence or a clear failure appears.
5. Release the lease and leave the session running. A long-running server is not a failed task merely because the shell never exits.

## Inspect history and whether input is needed

Example request: "Check the Codex terminal, show me recent history, and tell me whether it is waiting for me."

1. Resolve the session with `app_terminal_session_list`; ask the user when the title is ambiguous.
2. Call `app_terminal_session_state_get` for lifecycle, attention evidence, and watermarks without output text.
3. Use `app_terminal_session_view_get` for a bounded screen or scrollback view, or `app_terminal_session_output_read` when exact retained PTY records are needed.
4. Report `waiting`, `not_waiting`, or `unknown` with the returned reason, confidence, detection time, and evidence watermarks. Silence, an observe timeout, or a prompt-looking character is not enough to change `unknown`.
5. Report every `gap`, `truncated`, `degraded`, or `hasMore` fact. Retained output is not guaranteed to be complete history.

## Continue Claude Code, Codex, or another interactive program

Example request: "Tell the Agent in this terminal to continue fixing the tests."

1. Read current state and a bounded view so the requested input is appropriate for the foreground interaction.
2. Acquire control. If another automated controller owns the lease, return the redacted busy result and use bounded observation or ask the user; never take over silently.
3. For one line followed by Enter, use `app_terminal_session_input_command`. For text plus explicit navigation or control keys, use `app_terminal_session_input_send`.
4. Observe new state and output from the pre-input watermarks. Accepted input immediately invalidates old waiting evidence, so do not reuse it as proof of the new state.
5. Report that the instruction was submitted or work started only after fresh output, a working state, or a rendered view proves the prompt has cleared. If the complete instruction remains visible in the input area, acquire or renew control as needed, send exactly one Enter key, and observe again; do not resend the instruction text.
6. Never approve a risky prompt merely because the program is waiting. The user's request to control a terminal is not blanket approval for every foreground action.
7. On `partial` or `delivery_uncertain`, do not replay the instruction. Report the operation id, accepted boundary, and latest observable facts without exposing private lease data.

### Fast path for one interactive instruction

1. Read `app_terminal_session_state_get` and `app_terminal_session_view_get` in parallel.
2. If the session is running and the screen confirms the intended foreground program, acquire one lease and send the instruction.
3. Observe once from the state/output watermarks captured before input. Reuse the returned `inputRevisionAfter` if another input is required.
4. If the observation proves the result, release the lease and finish. Do not perform a second screen read merely to reconfirm the same output.

### Exit an interactive program but keep the terminal

Example request: "Close this Claude Code conversation but leave the Synapse terminal open."

1. Read state and the rendered screen in parallel. Do not begin with Escape or Ctrl+C unless the screen shows a modal or foreground work that must first be cancelled or interrupted.
2. Use the program's visible exit instruction or known graceful exit command. For Claude Code, Escape may interrupt one active response or retry, but normal exit from its input prompt uses `/exit`; do not enter a repeated Ctrl+C exit sequence.
3. If the program explicitly asks for Ctrl+D again, reuse `inputRevisionAfter` and send exactly one more Ctrl+D while the lease is valid. When tool composition is available, keep this observe-and-confirm branch in one orchestration call so a short confirmation window cannot expire between model turns.
4. If interrupting Claude leaves prior text in the input area, remove exactly the visible characters with Backspace, verify an empty prompt once, and send `/exit` as a command. Do not use Ctrl+C to clear the buffer or confirm exit.
   Renew immediately before each of these post-observation writes unless acquire or renew happened in the same composed chain. Use the renew result's `inputRevision`; a failed write is not a lease-freshness probe.
5. Stop when the observation or rendered output proves the shell prompt has returned while lifecycle remains `running`. A resume command printed before the shell prompt is also strong evidence that the interactive Agent exited. Do not run `pwd`, `echo`, `printf`, or another probe command merely to reconfirm that the visible shell prompt accepts input.
6. Do not send additional Ctrl+D at the shell prompt, because that can close the shell and contradict the request to keep the terminal open.
7. Release the lease and finish from the evidence already collected. Do not append a final state read plus screen read unless the exit evidence omitted a required fact; if both are needed, request them concurrently.

This flow should normally require one parallel read, one lease, one or two evidence-directed inputs, one observation after each input, and one release. More calls require new evidence, a conflict, or an uncertain delivery outcome.

For a lease-critical composed flow:

1. Read state and screen concurrently before acquiring control.
2. Acquire only after the next action is known.
3. Send one action, inspect its structured result, and observe bounded output.
4. Branch to a second action only when the observation explicitly requires it.
5. Release in the same orchestration call when the goal is proven or no more input is justified.

Do not send any input after a failed acquire or renew. Do not issue a second write after an HTTP 5xx; one read-only recovery probe is the maximum before reporting the unavailable transport.

## Interrupt, stop, and delete

Example request: "Stop the current build but keep the terminal."

- Acquire or retain the control lease and send the fixed Ctrl+C key through `app_terminal_session_input_send`. This interrupts the foreground task and does not change Terminal lifecycle.

Example request: "Close the terminal normally."

- Call `app_terminal_session_stop` without acquiring a lease. Observe until lifecycle is `ended`, `failed`, or `lost`; an accepted stop operation alone is not final termination.
- Do not escalate a timeout or uncertain delivery to `app_terminal_session_force_stop`. Force stop requires an explicit user request.

Example request: "Delete that test terminal."

- Confirm the exact `sessionId` and terminal lifecycle, then call `app_terminal_session_delete`. A `running` or `stopping` conflict means stop, observe, and delete are three separate user-requested steps.
- For a nonempty group, use `app_terminal_group_delete_preview`, present the bounded impact when confirmation is needed, then commit the unchanged, unexpired plan. No delete tool implicitly stops sessions.

## Launch a saved group command

Example request: "Run the saved Start Backend command in its group."

1. Resolve the group and command through `app_terminal_group_list` and `app_terminal_group_command_list` without reading the command body.
2. Call `app_terminal_group_command_launch` with exact group, command, launch, and command revisions plus a unique idempotency key.
3. Treat the returned session and command-delivery operation as separate facts. The launch permission does not imply state, output, control, stop, or delete permission on the new session.
4. Do not resend uncertain or partially delivered saved input. Real shell echo may make the command visible to a caller who separately has output permission.

## Handle policy and unsupported features

- `permission_denied`: stop the blocked step and report that a local policy denied the operation. Do not ask the user to authenticate or grant Terminal access, do not reveal whether an id exists, and do not retry through another tool.
- `control_busy`: do not queue hidden input or seize control. Observe within limits, retry only after a deliberate bounded wait, or ask the user.
- revision conflict: refresh the narrow object or state that owns that revision and reconsider the action. Do not overwrite concurrent UI changes.
- unsupported or degraded capability: explain the functional limitation. Preserve authoritative raw output where available; do not invent rendered state, attention evidence, raw byte support, or force-stop behavior.
- quota or rate limit: honor the returned safe retry guidance. Running sessions have no per-client count cap. `global_running_sessions` is a structural Terminal-wide limit, so do not immediately replay the same create request without a concrete retry delay or fresh evidence that capacity changed. Never kill an existing session merely to make room unless the user separately asked to stop that exact session.
