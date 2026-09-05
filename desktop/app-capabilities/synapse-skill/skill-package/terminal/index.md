# Synapse Terminal MCP

Use Terminal tools to operate Synapse-managed interactive PTY sessions. Terminal is a shared UI/MCP object space, not a one-shot command runner. Use the current tool schemas directly and immutable ids for every sensitive read or mutation. Call `app_terminal_capabilities_get` only when runtime or platform support facts are needed, after reconnecting, or after an unsupported/degraded result.

Read `api-reference.md` before constructing requests. Read `examples.md` when translating a user goal into a multi-step Terminal workflow.

## Interpret the request

- Translate the user's goal into the narrowest required operations. Creating, observing, reading output, controlling input, stopping, and deleting are separate permissions and separate decisions.
- Treat titles and group names only as discovery aids. If a name matches more than one object, show the bounded matches or ask the user to choose; never guess.
- A visible session is not automatically safe to control. Operate on an existing UI-created session only when the request identifies it or clearly asks to continue work there. Track ids created during the current task so later actions remain within the requested scope.
- Local Terminal MCP requires no separate authentication or Terminal grant. `supported` only describes platform availability; it does not expand the user's request. On `permission_denied`, report that a local policy blocked the operation instead of asking the user to log in or authorize Terminal in Synapse.
- Terminal MCP is still in development and exposes one current contract. Do not send `contractVersion`, probe for a v1/v2 variant, or call removed aliases such as `app_terminal_session_read`, `app_terminal_session_write`, and `app_terminal_group_update_settings`. If current `app_terminal_*` tools are absent after Synapse was updated, ask the user to restart Synapse and open a new Codex task so the tool catalog is rebuilt.
- Launch settings resolve as global, group, saved command, then explicit one-time override. They affect only newly created PTYs. A saved command's layer configures its whole new session before Synapse delivers the saved input sequence.
- Launch-setting reads expose environment keys, `set/unset`, source, and revision but never values. Do not infer, request, or report a secret value from metadata. Preserve unmentioned entries in sparse updates; use `settings.inheritEnvironmentKeys` to restore inheritance for named keys.

## Safe operating flow

1. Discover groups or sessions with bounded list tools. Preserve the returned immutable ids, revisions, domain revision, and pagination cursor only for the same query.
2. Create through the path that matches the user's intent: ordinary UI-equivalent session, explicit audited overrides, or a saved group command. Do not turn an ordinary create into an override.
3. Read lifecycle and attention through `app_terminal_session_state_get` or `app_terminal_session_observe`. These tools never return output bytes.
4. Read retained raw output through `app_terminal_session_output_read`, use `app_terminal_session_view_get` for a bounded human-readable terminal view, or combine state and bounded output with `app_terminal_session_output_observe` when both permissions are available.
5. Before automated input, acquire a short lease with `app_terminal_session_control_acquire`. Keep its `leaseId`, `leaseRevision`, expiration, and current `inputRevision` private.
6. Send one single-line text plus Enter with `app_terminal_session_input_command`, or bounded semantic text/key actions with `app_terminal_session_input_send`. Supply the exact expected input revision and a fresh caller-scoped idempotency key for that distinct request.
7. Observe the resulting state and output using independent state and output cursors. Input acceptance is not task completion.
8. Explicitly renew the lease only while more input is needed, then release it. Input never renews a lease.

## Keep interactive work efficient

- Use the fewest calls that provide new evidence. Do not call capability discovery by habit or repeat it within the same task unless reconnecting or recovering from an unsupported/degraded result.
- After creating a session for the current task, do not immediately read its state or screen before a known first command. Creation already proves the session identity, lifecycle, and initial watermarks; acquire control only after the first input is decided, and use the acquire result's current input revision.
- For an existing interactive session, read state and a bounded screen in parallel when both are needed. State supplies lifecycle, watermarks, and `inputRevision`; the screen supplies foreground context. Do not perform the two reads serially without a dependency.
- When the host can compose dependent tool calls inside one orchestration call, keep a lease-critical chain inside that call: parallel read, decide, acquire, input, bounded observe, evidence-based follow-up input, then release. Do not spend separate model turns between acquiring or renewing a lease and using it.
- Acquire control only after deciding the next input. Choose a lease duration that covers the immediate interaction; for a likely two-step terminal transition, prefer the supported 60-second lease over repeatedly reacquiring a 30-second lease. If composition is unavailable, renew immediately before the next input when observation or reasoning consumed most of the lease.
- Treat lease freshness as unknown after an observe-and-reasoning boundary unless acquire or renew happened in the same composed tool chain. Before the next write, renew once and use the returned `inputRevision`; do not test lease freshness by attempting a write and then recover from `lease_expired` with another acquire.
- If acquire or renew fails, do not send input with that lease. Re-read only the facts needed to recover, then acquire a fresh lease before any later input.
- Reuse the `inputRevisionAfter` returned by successful input. Do not call `app_terminal_session_state_get` merely to rediscover that revision.
- Idempotency keys are request identifiers, not secrets. Construct a stable descriptive literal in the request itself, such as a task or session label plus the action and sequence. Do not run helper code, invoke another tool, or depend on a host-language random/crypto global solely to generate the key. Reuse a key only for the exact same canonical request when recovering from an uncertain result.
- After input, start with one `app_terminal_session_output_observe` from the pre-input watermarks. If it already contains decisive evidence, do not add a redundant view read. Use `app_terminal_session_view_get` only when raw output is ambiguous or rendered cursor state matters.
- An observe wakes on the first qualifying change, which may be only shell echo or a partial frame. For one expected transition, make at most two consecutive observe calls. If both are inconclusive, use one rendered view or stop for user judgment instead of building an unbounded observe loop.
- For Codex and other interactive Agents, do not report that an instruction was submitted or work started until fresh evidence shows the prompt cleared, a working state, or new execution output. If a bounded view instead shows the complete instruction still present in the input area after an accepted command, acquire or renew control as needed, send exactly one Enter key, and observe again. Do not resend the instruction text.
- Treat every control key as a state transition: send one justified action, observe, then decide. For a program's explicit short-lived confirmation prompt, perform the observe-and-confirm branch inside one orchestration call so the evidence remains fresh; do not replace it with a blind double-key batch. Never spray Escape, Ctrl+C, or Ctrl+D variants until one appears to work.
- For Claude Code, use Escape at most once to interrupt an active response or retry. Once its input prompt is visible, Ctrl+C is not the normal exit path: repeated Ctrl+C confirmation states can redraw or preserve stale input and tempt the caller into a loop. Clear any visibly retained input with the exact required Backspace actions, verify the prompt is empty, then submit `/exit` with `app_terminal_session_input_command`.
- Stop as soon as the user's goal is proven. A rendered shell prompt with `running` lifecycle is sufficient evidence that the shell is ready after an interactive program exits. Do not send `pwd`, `echo`, `printf`, or another probe command solely to prove the prompt accepts input; do not continue sending EOF or stop the Terminal session.
- Do not add ceremonial final reads. A decisive observation can prove both the shell prompt and `running` lifecycle; after releasing the lease, finish unless a required fact is still missing. When both state and rendered view are genuinely needed, read them in parallel.
- A transport-level HTTP 5xx provides no trustworthy operation result. After a failed write, do not replay it; make at most one bounded read-only recovery probe. If the transport is still unavailable, stop and report instead of repeatedly probing capabilities, state, and view.
- The only running-session count bound is the Terminal-wide `global_running_sessions` resource limit; there is no per-client running-session cap. A global quota cannot change through an immediate replay, so stop and report unless the response gives a concrete bounded retry delay or there is fresh evidence that a slot was freed. Never stop another session merely to make room without a separate user request.

## Choose the input method

- Use `app_terminal_session_input_command` for one control-free line followed by Enter, including an ordinary shell command or a one-line answer to an interactive program.
- Use `app_terminal_session_input_send` when text and explicit keys such as Enter, Tab, Escape, arrows, Backspace, Ctrl+C, or Ctrl+D must be ordered precisely.
- Use `app_terminal_session_input_paste` only for bounded multiline text when fresh terminal evidence confirms bracketed-paste mode. It never submits an Enter afterward.
- Use `app_terminal_session_input_raw` only as a high-risk escape hatch when semantic input cannot express the task and the user request requires it.
- Do not look for or invent a generic `shell.exec`, `terminal.execute`, delay action, or unbounded streaming tool.
- Escape cancels a transient UI state, Ctrl+C interrupts foreground work, and Ctrl+D sends EOF. None is a universal “close interactive program” action. Follow the program's rendered instruction or known command, and verify the resulting foreground state before sending another key.
- Do not summarize away repeated control actions. If recovery used more keys or calls than intended, report the actual sequence so later optimization is based on the real trace.
- Build the final action sequence from the completed tool trace, not from the planned workflow. Preserve the real order of reads, release, and any recovery calls; for example, an evidence read performed after lease release must be reported after the release.

## Decide when the task is done

- For a finite command, use new output and state evidence to report what is proven. If no reliable completion or exit evidence exists, say that input was accepted and show the latest bounded observation instead of claiming success.
- For an interactive Agent, distinguish a proven question or approval request from `unknown`. Unknown does not mean waiting or not waiting. When the next input would be ambiguous or risky, present the current bounded view and ask the user.
- For a development server or other long-running process, verified startup output may satisfy the user's goal while the session remains `running`. Release the input lease and leave the session running unless the user asked to stop it.
- Running a PM2 or detached-daemon command does not make that external process part of the Terminal lifecycle. Do not claim that stopping the PTY stops detached services.

## Rules

- Treat `waiting`, `not_waiting`, and `unknown` as evidence-backed observations. Silence is not waiting; timeout from observe is not a state conclusion.
- A successful input result means Synapse accepted bytes, not that the foreground program processed or completed them. Never automatically retry `partial` or `delivery_uncertain` outcomes.
- `text` rejects control characters. Use fixed key actions for Enter, Tab, Escape, arrows, Backspace, Ctrl+C, and Ctrl+D. `command` is only text plus Enter and rejects multiline text.
- Use bracketed paste only through `app_terminal_session_input_paste`; unavailable or stale mode evidence has no literal fallback. Use raw input only when necessary for the user's request.
- Raw Base64 transport does not promise arbitrary binary transparency. Follow the current `supportedEncoding` and limitations returned by capability discovery.
- Normal stop and force stop are separate operations. Stop success means delivery was accepted; observe until `ended`, `failed`, or `lost`. Never auto-escalate a timeout to force stop.
- Delete only terminal sessions. Running or stopping sessions must be stopped and observed to terminal state first. Nonempty groups require preview and commit; no delete operation implicitly stops a session.
- Retained output is bounded. Honor `firstSeq`, `nextSeq`, `gap`, `truncated`, `hasMore`, and recovery cursors. A missing retained interval is not proof that the session never produced output.
- Saved command launch creates a new interactive shell and submits the saved logical lines as text plus Enter. It does not expose the command body and does not grant later control or output access.
- Terminal runs as the current OS user without a process sandbox. A shell or saved command can have arbitrary file, network, credential, and process side effects within that user account.
- User-defined toolbar actions are UI-private preferences and are not Terminal MCP resources. Use the existing session input tools instead of trying to list or mutate toolbar buttons.
- Prefer a narrower MCP capability whenever it directly matches the requested task.
