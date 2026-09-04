# Terminal MCP Control Design

Status: accepted; implementation authorized on 2026-07-22. Public rollout remains gated by the verification section.

## Objective

External Agents can create, discover, observe, read, control, manage, terminate, and delete Synapse Terminal objects with capabilities that align as closely as practical with the Terminal UI. The product is a shared Terminal object model, not a one-shot command runner.

Required user outcomes:

1. Create an ordinary Terminal with the same defaults as the UI.
2. Create under a selected group and inherit the group's launch semantics.
3. Observe current lifecycle and evidence-based attention state, including whether user input may be required.
4. Read retained historical output and continue incrementally.
5. Drive interactive Agents and TUIs, or run commands, development services, builds, PM2, and scripts.
6. Rename, stop, force-stop, and delete sessions and manage groups and stored commands when those operations are within the user's request.

## Current implementation facts

The existing implementation is one App Capability package under `desktop/app-capabilities/terminal/`. Renderer operations enter through IPC and MCP enters through the capability dispatcher, both calling `TerminalService`, but current contracts are not yet aligned:

- The store is unversioned `userData/terminal/terminal-state.json`, containing groups, sessions, and output strings.
- Session states are `running`, `exited`, `killed`, `failed`, and `lost`; startup restoration maps stale running records to lost.
- Output is retained per session with a fixed current limit and no Terminal-domain global quota.
- Renderer xterm owns display emulation; no headless core emulator or attention detector exists.
- `session.write` accepts an arbitrary string without a writer lease, semantic action model, or caller ownership.
- `session.stop` writes `killed` before confirmed exit and calls one `pty.kill()` path; its `force` field has no proven separate semantics.
- `group.delete` can delete sessions and kill runtimes implicitly.
- Group-command launch immediately converts logical newlines to Enter and filters echoed command text before persistence.
- PTY launch copies Electron `process.env` before setting Terminal variables.
- The original Terminal MCP permission check collapsed to shared `shell.exec` and did not provide the stable client and controller identity required for leases, quotas, and audit.
- Existing live events cover output and some session changes but do not provide complete group, command, and MCP-created-object synchronization.

Focused baseline tests for the current Terminal service, output buffer, dispatcher, IPC, App capability mapping, and MCP RPC passed before this discussion: 6 files and 123 tests. This is a fact snapshot, not evidence that the new contract exists.

## Product and implementation separation

Product requirements are the object, authorization, lifecycle, observation, input, retention, deletion, and error semantics in this document. Implementation mechanisms such as a particular headless emulator, checkpoint serializer, encryption primitive wrapper, or platform termination adapter remain gated by the named technical spikes. An unsupported or degraded result is acceptable where the platform cannot prove the contract; silently lowering correctness is not.

## Unified objects and identities

UI and MCP share the same groups, commands, sessions, histories, revisions, and immutable `sessionId`. There is no MCP-only Terminal.

- A `sessionId` identifies one runtime attempt and is never reused.
- A terminal session that ends or is lost retains metadata and retained history but cannot be restarted under the same id.
- Starting again creates another session.
- Explicit deletion invalidates identity, metadata, and retained bodies after the bounded tombstone window.
- Creation source and actor are audit and quota metadata, not ownership isolation.
- UI sees MCP mutations and local MCP can discover UI-created objects in the shared local user space.

## Local caller identity and operation boundaries

Every local HTTP MCP installation maps to a stable `clientId` and the existing local MCP user actor. Each concurrent Agent task also has a trusted `controllerInstanceId` supplied by transport context or a server-bound handle. These identities are not credentials and require no Terminal-specific authentication handshake, token, login, or explicit grant.

The loopback HTTP MCP uses the same default local-user permission path as the rest of Synapse MCP. Terminal permission families remain separate capability, policy, and audit categories, but the local caller does not apply for them individually. The retired stdio bridge is not built or packaged; existing stdio registrations migrate to HTTP. A future remote MCP transport must define its own standard authentication boundary without changing this local behavior.

The Agent must still stay within the user's requested operation and use the narrowest matching capability. Creating, reading, controlling, stopping, and deleting remain separate actions. A visible object is not permission to perform an unrelated action, and a write lease only coordinates input ownership.

Permission families:

- `discover`
- `state.read`
- `metadata.read`
- `output.read`
- `command.read`
- `command.launch`
- `session.create`
- `session.override.create`
- `session.control`
- `session.rawInput`
- `session.resize`
- `session.stop`
- `session.forceStop`
- `metadata.manage`
- `group.manage`
- `command.manage`
- `session.delete`
- `group.delete`

No family implies another operational step. In particular, create is not control; control is not output, stop, or delete; output is not command or metadata; and a write lease is not user intent. Permission checks occur before sensitive existence checks so an explicit policy denial does not reveal whether an object exists.

## Lifecycle, attention, and operations

Lifecycle is `running | stopping | ended | failed | lost`.

- `running`: PTY is live and can participate in ordinary input control.
- `stopping`: a termination request was confirmed delivered; ordinary input is rejected.
- `ended`: confirmed PTY exit, including nonzero process exit codes.
- `failed`: unrecoverable Terminal infrastructure failure after identity creation.
- `lost`: the runtime once existed but Synapse cannot confirm or recover it.

Termination facts carry cause, exit code, signal, end time, and applicable operation and requester facts. A missing legacy end time is represented as unknown rather than fabricated.

Attention is independent and tri-state: `waiting | not_waiting | unknown`. Unknown is the default. Waiting and not-waiting require explainable evidence. Results include detector id and version, attention kind, stable reason, confidence, detected time, output and size watermarks, and no matched body.

Initial attention detection is passive:

- Strong evidence is a verifiable structured marker or protocol actually emitted by the program.
- Medium evidence combines foreground-process identity, versioned adapter, rendered state, and prompt structure.
- Silence, isolated prompt characters, process name, output activity, or CPU alone never decides attention.
- Any accepted input invalidates old waiting evidence to unknown.
- Output, resize, degraded rendering, or mode change invalidates dependent evidence until reconfirmed.
- Non-running lifecycle has unknown attention.
- No Shell integration is injected by default.

Asynchronous operation status is `pending_delivery | delivered | delivery_uncertain | completed | failed` and remains separate from lifecycle. Completion includes final lifecycle and cause. `operation.get` requires current state-read authorization over the original resource; an operation id alone cannot probe existence.

On graceful application shutdown, Synapse may attempt only the proven normal-stop path and never silently force. Confirmed exits become `ended` with an application-shutdown cause. Runtimes not confirmed before shutdown become `lost` with an application-shutdown-unconfirmed cause. A stale running record found after crash or restart uses a distinct unexpected-restart cause. Recovery never retransmits termination actions.

## Revisions and watermarks

- `terminalDomainRevision`: global persistent low-frequency structure revision for groups, commands, session identities and memberships, low-frequency metadata, and queryable operation collection.
- `groupRevision`: overall group-object revision.
- `launchRevision`: launch semantics only.
- `membershipRevision`: group member set.
- `commandCollectionRevision`: command collection reads, plans, and authorization decisions.
- `commandRevision`: one stored command.
- `metadataRevision`: session display and affiliation metadata.
- `stateRevision`: per-session lifecycle, attention, lease, size, operation-status, and other observable state.
- `sizeRevision`: per-session PTY dimensions.
- `inputRevision`: accepted input ordering.
- `outputSeq`: per-session retained output-record position.

Output does not advance the global domain revision. The raw output authority begins at the ordered data delivered by the packaged node-pty runtime to Terminal core; it does not claim access to bytes that node-pty did not expose. Core splits delivered data into bounded, UTF-8-safe records before assigning positive, non-reused output sequence numbers. `afterOutputSeq` is the last consumed record, `firstSeq` is the earliest retained record, and `nextOutputSeq` is the greatest known record cursor, or zero before output. Missing records are explicit gaps. The raw-input byte contract is separately limited by proven node-pty write behavior.

Low-frequency user and Agent mutations wait only until a persistence snapshot containing that mutation has settled. They never wait for the shared Terminal persistence queue to become globally idle, because later PTY output may continue scheduling independent snapshots without bound.

## Creation and group inheritance

Three creation paths exist:

- `session.create`: without group, use the same unified default snapshot as UI ordinary create; with group, strictly inherit `expectedLaunchRevision`. It accepts no cwd, shell, environment, or size override. Title is display metadata.
- `session_override.create`: explicit override intent and fields in the override-create permission category. Cwd, shell, environment, and initial dimensions are individually recorded in redacted launch facts. Initial dimensions also require the resize permission check.
- `group_command.launch`: exact group and command ids, expected launch and command revisions, and idempotency identity only. It accepts no command body or launch override.

Permission checks, revisions, resolution, and predictable validation complete before identity creation. A PTY infrastructure failure after identity creation retains a failed session and returns its traceable id. Success means the session reached running, not that the shell is ready or any command succeeded.

Create idempotency binds client, capability, caller key, and canonical request digest for a bounded window. Same key and request returns the original session; a changed request conflicts; keys do not collide across clients.

Command launch is an independent restricted creation operation. It pins the requested command and launch revisions for that call; changed executable content produces a revision conflict and requires the Agent to reread facts and reconsider the action. Creating the session does not itself acquire an input lease or prove that later control, stop, or delete actions are within the user's request.

## Stored group-command delivery

A stored command is a bounded UTF-8 logical-line input sequence. Saving normalizes CRLF to LF and rejects ESC, NUL, and unsupported control characters. An empty command body is invalid; empty lines inside the body are preserved as Enter-only actions; one final LF is treated as the terminator of the preceding logical line rather than an additional blank command, while each further final LF preserves one intentional empty line.

Launch creates an interactive shell and submits each logical line as text plus Enter. It is not `shell -c`, a script, or a transaction. The command-launch operation permits only this one-time delivery without a lease and advances the session input revision. The response contains a separate command-delivery operation. Failure or uncertainty retains the session, reports the known acceptance boundary, and never automatically retransmits. Idempotent replay never creates or writes again.

Queued input after PTY establishment must be proven on every packaged platform or command launch is unsupported there. Core preserves real Shell echo in raw output. API responses do not echo the command proactively, but output readers may see what the real terminal echoes.

## Discovery and sensitive reads

All collections have default and hard maximum limits, stable sorting, opaque cursors bound to sort, filters, and query, and a corresponding domain-revision snapshot. Session sorting uses immutable `createdAt + sessionId`.

- `session.list` requires discover and returns only id, title, group, creation time, source, and non-state facts.
- `session_state.list` requires discover plus state-read and adds lifecycle, attention freshness, redacted lease occupancy, and state and output watermarks.
- `group.list` returns group identity, name, necessary revisions, member count, and command count without sensitive values.
- `group_command.list` returns command identity, display name, and revision without body.
- `session_summary.get` is a non-state, non-sensitive exact summary.
- `session_state.get` returns state and caller-visible lease summary, never output.
- `session_metadata.get`, `group_launch.get`, and `group_command.get` remain separate sensitive detail operations.

Diagnostics are bounded to the local caller's visible objects. Structural counts require discover and state-read checks as applicable. Numeric output-storage details require the output-read check; a fixed tagged result reports policy denial rather than silently adding or omitting fields. Diagnostics never reveal other actors or their usage.

## Observation, output, and rendered views

- `session.observe`: state-read; bounded wait for state or output-watermark change, returning no output body.
- `session_output.read`: output-read; bounded non-waiting retained raw-output read.
- `session_output.observe`: state-read plus output-read; fixed-shape consistent state snapshot and bounded output delta.
- `session_view.get`: output-read; bounded visible-screen or scrollback view with cursor, dimensions, generation time, through-output sequence, degraded flag, and reasons.

Observers independently maintain `afterStateRevision` and `afterOutputSeq`; reads do not consume shared output. Existing changes return immediately. Timeout returns `changed=false` and implies nothing about attention. A cursor in an eviction gap returns immediately with the retained interval and recovery cursor. Invalid future positions return explicit errors. Per-session, client, and global pending-wait limits and cancellation apply.

Raw output is authoritative only within its retained interval and is not a human transcript. ANSI-stripped text is at most a convenience result. Rendered views come from core terminal emulation, not Renderer state.

Core emulation consumes the same ordered stream and tracks bounded screen, cursor, modes, and scrollback with output, size, and emulator-version facts. Checkpoints reference only committed output and are validated on recovery. Missing prefix, checkpoint, version, digest, or size produces degraded reasons rather than fabricated rendering.

The desktop Renderer attaches to a bounded serialized state from the same core emulator and continues from its output watermark. It never restores an interactive screen by replaying retained raw output at the latest size. Resize participates in the ordered emulator stream and publishes a geometry barrier so the Renderer applies prior-size output before resizing its existing xterm instance and later output afterward.

The headless emulator and serialization path require a technical spike in Electron main without DOM, on all packaged platforms, including memory and performance bounds. Handwritten incomplete ANSI parsing is prohibited. Candidate new dependencies are `@xterm/headless` and a compatible official serialization addon; they may be added only if the spike proves the design and final approval covers them. If the spike fails, raw output remains supported while view and dependent attention behavior report unsupported or degraded.

## Output retention and persistence

Retention has configurable per-session rolling limits and a global Terminal-output quota. Global eviction is deterministic: prefer oldest output of ended or lost sessions and affect running sessions last. Eviction deletes bodies, not identity or necessary metadata. Empty retention still reports policy, first and next sequence, cumulative loss, last eviction, and gap/truncation. There is no default time-based expiry.

Structured records live in registered versioned DataRepository namespaces:

- `app.terminal.groups`
- `app.terminal.commands`
- `app.terminal.sessions`
- `app.terminal.workspaces`
- `app.terminal.operations`
- `app.terminal.idempotency`
- manifest and quota-index records as required

Command metadata and encrypted-body references live in structured storage; sensitive bodies never become plaintext SQLite fields.

Raw output and emulator-checkpoint bodies use a Terminal-owned bounded block store as a narrow approved exception. Blocks use unguessable internal identities, owning session, type, size, digest, restrictive file permissions, and no exposed path. Writes use staging, authenticated-encryption verification, atomic rename, and metadata transaction or equivalent recovery ordering. Recovery detects orphans, missing or corrupt blocks, and reconstructs quota indexes. Delete intent persists before file removal, and failure retains retry metadata.

## Encryption and backup

Persisted output, checkpoints, derived scrollback, command bodies, environment values, and other recoverable sensitive bodies require shared Synapse encryption. OS safeStorage protects a data key; verified chunked authenticated encryption uses independent nonce and tag with AAD binding block, session, type, and schema version. Digests do not substitute for authentication.

When secure encryption is unavailable:

- Terminals and current in-memory output still work.
- Sensitive bodies do not become restart-persistent.
- Saving commands or sensitive launch configuration is rejected.
- Capability and diagnostics expose only safe protection availability and functional limitations.
- There is no plaintext fallback.

The ordinary desktop backup contains Terminal structure, revisions, lifecycle and end facts, redacted launch facts, and necessary completed-operation facts. It excludes output, checkpoints, derived scrollback, leases, pending observations, and short-lived idempotency. Plaintext ordinary backup excludes command bodies. It preserves historical output watermarks and restores an empty interval with `gap`, `truncated`, and `reason=backup_excluded`; views without reconstruction are degraded. Restored running or stopping sessions become lost with a restore cause, and pending termination is never replayed.

Terminal restore has a dedicated validated plan and atomic or recoverable commit rather than generic partial import. A future full-history backup is a separate encrypted, size-disclosed format.

## Legacy migration

Migration uses the shared `VersionedDataMigrator`, exact-byte backup, source-digest recheck, full target validation, atomic cutover, and a permanent anti-resurrection marker. Encryption failure prevents cutover and preserves the legacy source.

Lifecycle mapping:

| Legacy | New | Cause |
|---|---|---|
| `running` | `lost` | `legacy_runtime_unrecoverable_after_restart` |
| `exited` | `ended` | `legacy_process_exit` |
| `killed` | `ended` | `legacy_killed_unclassified` |
| `failed` | `failed` | `legacy_infrastructure_failure_unclassified` |
| `lost` | `lost` | `legacy_runtime_lost` |

Existing exit facts are preserved only when present; unknown remains unknown. Migration creates no actor, caller identity, lease, attention, idempotency, or stop/force operation. New revisions start from a marked baseline. Input revision zero means post-migration baseline with pre-migration history unknown. Old launch facts are `legacy_unversioned` with unknown applied launch revision.

Legacy output preserves provable sequences, represents inconsistencies as gaps, encrypts strings as `legacy-js-string-utf8`, and does not claim original arbitrary bytes. Echo-filtered data is unrecoverable. A lone `startupCommand` becomes a marked stored command only when no command collection exists; otherwise it remains a diagnosed shadowed field and creates no new executable entry.

## Control leases and semantic input

One running session has at most one automated writer. The owner is `sessionId + clientId + trusted controllerInstanceId`. A caller may control multiple different sessions. Reads remain concurrent without a lease.

- Acquire is immediate, running-only, bounded-duration, and has no queue or MCP takeover.
- Another controller under the same client is still busy.
- Renew is explicit; input does not renew.
- Create, acquire, and renew responses include the current `inputRevision`, allowing a caller with a known next action to satisfy mandatory input ordering without a redundant state read.
- Release is owner-checked and idempotent; a late old release cannot affect a new lease revision.
- Timeout, release, stopping or terminal lifecycle, local policy revocation, or explicit local-user takeover invalidates the lease and advances state revision.
- Lease ids are unique, non-reused operation handles, not authentication credentials, and are redacted in logs and audit.

Semantic input requests contain session, lease, mandatory expected input revision, caller-scoped idempotency key, and bounded actions. Actions are control-free text or a fixed server-encoded key enum. Text prevalidation rejects CR, LF, ESC, NUL, and unsupported controls and applies action, segment, and total UTF-8 byte limits. Delay actions are unsupported.

Expected input revision must match exactly. Concurrent requests cannot rely on network order. After validation, actions are written continuously and in order without another automated writer interleaving, but are not transactional. Accepting any byte advances input revision. Results persist before response and report before and after revision, operation, accepted time, accepted actions and bytes, and partial failure boundary.

Input idempotency has a documented result and/or tombstone window. Same key and canonical request returns the original result without writing; a changed request conflicts. Outside the safe window, callers inspect current revision and never blindly replay.

`session_input.command` accepts exactly one control-free, single-line text and is only text followed by Enter. It shares the same lease, revision, idempotency, delivery, and audit rules and creates no alternate execution model.

Paste is bracketed-paste only. It requires current control but not raw permission and includes expected input and output evidence watermarks. Core accepts only fresh emulation evidence that bracketed paste is enabled, constructs the complete bounded frame, and uses the fewest supported writes. Unknown, disabled, or stale mode rejects before writing. An unconfirmable frame failure returns delivery uncertainty and must not be retried automatically. There is no literal fallback.

Raw input additionally requires raw-input permission. A single canonical Base64 payload shares lease, revision, idempotency, and partial acceptance. Base64 is not a promise of arbitrary binary transparency. Packaged node-pty tests define the byte set that can be preserved; unsupported sequences reject before writing, and capability metadata publishes encoding and limitations. Payloads, control sequences, and content digests never enter ordinary logs, audit, or errors.

## Resize

Automated resize requires resize and control permissions plus the current lease. Request dimensions are bounded and use mandatory expected size revision and idempotency. Actual UI or MCP size change advances size and state revisions; same size is a no-op. UI resize does not itself take over input but is observable and invalidates size-dependent view, attention, and paste evidence. Only running sessions resize. Success means the PTY accepted dimensions, not that the foreground application redrew.

## Interrupt, stop, and force stop

Ctrl+C is a semantic key input requiring the automated lease; it does not change lifecycle and only means input was accepted. A local user may first invalidate the lease for emergency interrupt.

Normal stop requires stop permission and no lease. Force stop requires force permission and is an explicit high-risk action, either directly on running or as an upgrade from stopping. Repeated same-level requests return the original operation; force upgrade creates and links a new operation. Terminal-state calls return `terminal_noop` without fake operations.

A platform termination adapter exposes machine-discoverable normal and force support, scope, and limits. Paths must have proven different strengths in the current packaged node-pty/runtime. Unix signals and process-group scope and Windows ConPTY, winpty, Job, and process-tree behavior require target-platform integration tests. Unsupported modes return explicit unsupported results and never fall back. Confirmed delivery moves to stopping; actual exit decides terminal state. Uncertain delivery is observed and never auto-replayed or auto-escalated.

Termination covers the managed PTY and only the process or process tree the platform adapter can prove. It does not promise to terminate detached daemons, PM2-managed processes, or external services.

## Deletion

Session delete accepts only ended, failed, or lost sessions, rechecks permission and lifecycle, and transactionally or recoverably removes identity, metadata, and retained bodies. Running or stopping conflicts and triggers no stop.

Empty-group delete requires expected group revision. Nonempty group deletion requires a bounded redacted preview and a server-side plan containing complete member and command sets, revisions, lifecycle facts, expected ranges, and expiry. Commit rechecks caller identity, permission, expiry, sets, revisions, and terminal state and deletes atomically or recoverably. Automatic output eviction may safely narrow deleted bytes; any expansion or unknown change invalidates the plan.

Delete idempotency and operation query survive only a bounded tombstone window. There is no delete-and-kill convenience operation.

## Structural synchronization

Core persists low-frequency structure before publishing a body-free event with domain revision, event type, object id and revision, time, source, and operation. Output and state notifications carry only session and watermarks or ranges. UI, IPC, and MCP use the same service and event semantics.

List snapshots return the corresponding domain revision, closing list-then-listen races. Renderer applies consecutive events and resynchronizes through bounded list/get after gaps or reconnect. Publication failure does not roll back business state; later gaps remain detectable. Initial MCP uses bounded observe/list/get; future subscriptions reuse revisions and never stream unbounded bodies.

## Management concurrency

- Session rename matches metadata revision and advances metadata plus state revision on change.
- Group rename matches group revision and does not alter launch revision.
- Launch settings update matches launch revision and advances launch plus group revision.
- Direct member creation, deletion, and future movement advance membership plus group revision.
- Command creation matches command-collection revision.
- Command update or delete matches individual command revision; updates advance individual, collection, and group revisions, while deletes advance collection and group revisions.
- Normalized equal updates are no-ops; conflicts never auto-merge.

All mutations have caller-scoped idempotency, operation id, before and after revisions, and changed or no-op result. Audit records field categories and revisions without sensitive values.

## Execution environment and resource limits

Terminal runs as the current OS user with `executionIsolation=none` and `processResourceIsolation=none`. Terminal permission checks and input leases are not a file, network, credential-agent, CPU, memory, or process sandbox. Capability metadata states this risk.

UI and MCP share `TerminalEnvironmentResolver`. Implementation first searches for existing safe Shell or login-environment utilities. The resolver positively constructs the environment from platform-tested base sources and allowed variables and does not copy all Electron process environment. A shared sensitive-variable source boundary excludes Synapse internal authentication, provider, update, and debug material. Explicit extra variables are encrypted, separately authorized, and audited by key or category only. Shell profiles may still load user credentials.

Configurable service quotas cover global running sessions, client and controller leases, session, client, and global observations, operation rates, input requests and bytes, output, emulator, checkpoints, and persistence. Running sessions are not capped per MCP client; the global running-session bound remains the resource-safety limit. Exceeding a limit rejects new work before acceptance and never creates a hidden input queue or kills existing sessions. Output hard bounds continue draining PTY while recording deterministic loss and degraded state. There is no default idle timeout.

## Results, errors, audit, and capability discovery

Every new tool returns a fixed contract-versioned envelope. Rejection before side effects is a structured error. Any possible side effect returns a traceable outcome such as accepted, partial, delivery uncertain, no-op, or failed after identity creation. Stable error categories cover validation, caller context, policy denial, not found, leases, lifecycle, revision and idempotency, cursors and watermarks, unsupported versions and capabilities, quota, persistence, and internal failure.

Permission is checked before existence. Messages are optional human text and are not machine semantics. Error surfaces contain no bodies, paths, credentials, stack, plaintext lease id, or another actor. HTTP MCP and IPC share codes and outcomes. Retryable never means an uncertain or partial operation is safe to replay.

Audit records actor, permission decision, scope, action type, key name, counts, sizes, revisions, result, and correlation identities. It never records text, raw or paste bodies, command or output bodies, password content, control sequences, credentials, or content digests.

`app.terminal.capabilities.get` is available to a stable local MCP caller without authentication or a Terminal grant and reports versions, support and degradation, permission combinations, risk, platform termination, raw limitations, paste, view, attention and persistence status, isolation facts, hard bounds, deprecation, and capability-set version. It reveals no objects, actors, usage, paths, environment, or key internals. Supported means implemented on the current platform, not that the Agent should perform an operation outside the user's request.

## Initial public capability baseline

Every capability id has exactly four dot-separated components in total as `app.terminal.<subdomain>.<action>`. Tool name is the id with dots changed to underscores. Identity, tool name, schema, permission, risk, versions, support, and deprecation metadata are generated or validated from one source.

| Capability id | Permission category |
|---|---|
| `app.terminal.capabilities.get` | none beyond local MCP identity |
| `app.terminal.diagnostics.get` | scoped discover and state-read; output sizes additionally require scoped output-read |
| `app.terminal.group.list` | discover |
| `app.terminal.group.get` | discover |
| `app.terminal.group.create` | group-manage |
| `app.terminal.group.rename` | group-manage |
| `app.terminal.group.delete` | group-delete; empty only |
| `app.terminal.group_launch.get` | metadata-read |
| `app.terminal.group_launch.update` | group-manage |
| `app.terminal.group_delete.preview` | group-delete |
| `app.terminal.group_delete.commit` | group-delete |
| `app.terminal.group_command.list` | discover plus command scope |
| `app.terminal.group_command.get` | command-read |
| `app.terminal.group_command.create` | command-manage |
| `app.terminal.group_command.update` | command-manage |
| `app.terminal.group_command.delete` | command-manage |
| `app.terminal.group_command.launch` | command-launch |
| `app.terminal.session.list` | discover |
| `app.terminal.session_summary.get` | discover |
| `app.terminal.session_state.list` | discover plus state-read |
| `app.terminal.session_state.get` | state-read |
| `app.terminal.session_metadata.get` | metadata-read |
| `app.terminal.session.create` | session-create |
| `app.terminal.session_override.create` | session-override-create; resize too when dimensions override |
| `app.terminal.session_metadata.rename` | metadata-manage |
| `app.terminal.session.observe` | state-read |
| `app.terminal.session_output.read` | output-read |
| `app.terminal.session_output.observe` | state-read plus output-read |
| `app.terminal.session_view.get` | output-read |
| `app.terminal.session_control.acquire` | session-control |
| `app.terminal.session_control.renew` | session-control and current owner |
| `app.terminal.session_control.release` | session-control and current owner |
| `app.terminal.session_input.send` | session-control and current lease |
| `app.terminal.session_input.command` | session-control and current lease |
| `app.terminal.session_input.paste` | session-control, current lease, and paste evidence |
| `app.terminal.session_input.raw` | session-control, raw-input, and current lease |
| `app.terminal.session.resize` | resize, control, and current lease |
| `app.terminal.session.stop` | session-stop |
| `app.terminal.session.force_stop` | session-force-stop |
| `app.terminal.operation.get` | state-read over original resource |
| `app.terminal.session.delete` | session-delete |

The canonical MCP tool name for each row is the complete capability id with dots replaced by underscores, for example `app_terminal_session_input_send`.

## Development contract

Terminal MCP is not yet a published compatibility surface. Development builds expose one current set of canonical capabilities and strict request schemas. Requests and response envelopes do not carry a public `contractVersion`; capability discovery reports runtime support and limits, not v1/v2 negotiation.

Removed or renamed development tools do not remain registered as legacy aliases. The built-in Synapse Skill, MCP registry, dispatcher, schemas, tests, and design documentation change together so agents use only the current catalog. Persistent-data `schemaVersion` values and object revisions remain independent internal mechanisms and are not Terminal MCP contract versions.

## Implementation scope

Implementation is inside the existing Terminal App Capability architecture and the shared systems it must extend. It includes:

- Shared capability schemas, ids, tool metadata, version negotiation, stable errors, and tests.
- Core service refactor so UI, IPC, and MCP use one domain implementation.
- Stable local client and controller identity integration with shared permission and audit services, without Terminal-specific authentication.
- DataRepository schemas, encrypted block store, recovery, migration, retention, backup projection, and restore planning.
- Lifecycle, operation, revision, event, observation, lease, semantic input, raw, paste, resize, termination, and deletion behavior.
- Renderer synchronization and explicit user takeover/emergency paths.
- Renderer workspaces persist a recursive split tree whose leaf panes reference immutable sessions. This layout is UI/IPC-only: closing a pane deletes its session, closing the sidebar workspace deletes every referenced session, and MCP continues to address sessions without controlling pane layout.
- One canonical development-time MCP tool set without compatibility aliases.
- MCP capability registration, dispatch, schemas, permission and risk declarations.

The new public MCP surface must remain gated until stable local caller identity, storage migration safety, unified service routing, error contracts, and applicable platform tests are ready. Unsafe partial tools are not exposed merely because their handler exists. View and attention may launch as unsupported or degraded if their technical gate fails; raw and stop modes are platform-supported only where proven.

Implementation order:

1. Record Git status and diff baseline and identify files already changed by other tasks.
2. Run the headless-emulator, node-pty raw-write, queued-command-input, platform termination, safeStorage/encryption, and environment-resolution spikes.
3. Finalize schemas, capability metadata source, local actor identity, permission integration, and migrations.
4. Build versioned structured storage, encrypted bodies, recovery, backup projection, and retention.
5. Refactor core lifecycle, events, state/output reads, and UI synchronization.
6. Add leases, semantic input, command wrapper, paste, raw, resize, stop/force, operations, and deletion.
7. Add capability discovery, diagnostics, and rollout gates.
8. Complete three-platform packaged tests, documentation synchronization, and staged review before enabling the new surface.

## Technical gates and dependency policy

Mandatory spikes and acceptance evidence:

- Official headless terminal emulation and serialization in Electron main, no DOM, bounded memory, packaged on macOS, Windows, and Linux.
- node-pty write input byte preservation and published raw limitations on each platform.
- Reliable queued saved-command input immediately after PTY establishment.
- Distinct proven normal and force termination paths and process-tree scope per platform.
- OS safeStorage availability, data-key recovery, rotation, ciphertext corruption, and unavailable behavior in packaged builds.
- Existing or new Terminal environment resolver providing necessary tool availability without Electron-internal secret inheritance.

No handwritten ANSI parser is allowed. The only currently anticipated optional dependencies are official `@xterm/headless` and compatible official serialization support; implementation may add them only after the spike proves compatibility and the final design approval explicitly covers the addition. No other dependency is authorized by this design without a new decision.

Initial implementation spike evidence on the development macOS arm64 runtime:

- `pnpm --filter @synapse/desktop run check:terminal-runtime` ran in an Electron 41 main process and loaded `@xterm/headless` 6.0.0 plus `@xterm/addon-serialize` 0.14.0 without a DOM, tracked bracketed-paste mode, serialized bounded state, and stayed within the spike heap limit.
- The packaged node-pty 1.1.0 Buffer path preserved the tested control, UTF-8, and non-UTF-8 bytes without a JS-string round trip; capability metadata still refuses to promise arbitrary binary transparency until every packaged target passes.
- Input queued immediately after PTY creation reached the shell reliably in the local integration spike.
- macOS proved distinct SIGHUP and SIGKILL paths. The current Windows node-pty path does not prove a distinct force strength, so force stop is reported unsupported there rather than being renamed `pty.kill` behavior.
- Existing safeStorage and login-shell environment infrastructure were reused. Data-key recovery, corruption, and unavailable-mode tests pass locally; sensitive persistence has no plaintext fallback. The standalone Electron spike could not query safeStorage while another Electron app instance held application readiness, so packaged app-ready safeStorage evidence remains part of the three-platform gate rather than being inferred from this run.

These local results authorize the official headless dependencies for the implementation branch, but do not satisfy the final macOS/Windows/Linux packaged acceptance gate by themselves. The public capability remains subject to packaged target results; a failing target must publish unsupported/degraded behavior rather than acquire a handwritten parser or weaker termination semantics.

## Verification and synchronization

Tests include:

- Unit, schema, contract, migration fixtures, storage corruption, quotas, idempotency, and permission-denial non-disclosure.
- Integration tests for one core service through UI IPC and MCP, event-gap resynchronization, multi-controller leases, partial delivery, delete recovery, and backup restore.
- Cross-version attention fixtures with false-positive and false-negative coverage for Claude Code, Codex, shells, password and approval prompts, and long-running services.
- Packaged macOS, Windows, and Linux tests for PTY spawn, environment, queued input, raw limits, resize, paste mode, exit, normal and force termination, emulator, encryption, and restart recovery.

The implementation task synchronizes:

- `AGENTS.md` stable data, backup, encryption, permission, MCP naming, and product boundaries.
- DataRepository registered schemas and migration history.
- Terminal capability schema and tool metadata.
- `desktop/app-capabilities/synapse-skill/skill-package/` Terminal guidance and API reference.
- Relevant Agent/user guides and backup/restore documentation.
- Current capability documentation synchronized with the MCP registry.
- `RELEASE_NOTES_PENDING.md` for user-visible behavior.

## Explicit non-goals

- No one-shot generic `shell.exec` or `terminal.execute` contract.
- No MCP session movement in the initial surface.
- No MCP takeover of a user or another controller.
- No hidden input queue, automatic replay of uncertain delivery, or timeout force escalation.
- No implicit stop in delete or delete-and-kill shortcut.
- No unbounded output, scrollback, observation, or subscription.
- No permanent complete history promise.
- No arbitrary binary raw-input promise.
- No Shell integration injection by default.
- No OS sandbox, CPU, memory, filesystem, network, or process-count isolation.
- No guarantee that detached daemons or external services terminate with the PTY.
- No ordinary backup of Terminal output, checkpoints, or plaintext command bodies.
- No Terminal-specific authentication or grant UI for the local MCP path.
- No public rollout before the required migration, encryption, local identity, and applicable packaged-platform gates pass.

## Concurrency worktree gate

Other tasks currently modify the same repository. Before implementation, record `git status` and the exact diff baseline. Modify only files required by this design. Stage and commit only exact files or hunks produced by this task and inspect the staged diff item by item. Never clean, format, revert, overwrite, or include unrelated concurrent changes. If a required file has a real overlapping edit, stop and report the conflict instead of guessing ownership.
