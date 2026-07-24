# Agent Local Reference Context Menu Design

## Goal

Let a user explicitly act on an already-recognized local reference in a completed assistant message without changing the reference's existing left-click behavior. V1 adds exactly two native context-menu actions:

1. `使用默认应用打开`
2. `在文件夹中显示`

The feature is an Agent conversation interaction, not an extension of the public File Opener capability.

## Scope

V1 applies only when all of the following are true:

- The content belongs to an assistant message in the main Agent conversation or detached Agent conversation window.
- The message is complete rather than streaming.
- The final rendered anchor is already recognized as an Agent local reference and carries the exact `data-reference` used by existing left-click handling.

This includes Markdown alias links and local image references when they reach the same recognized anchor representation. Visible text does not need to equal the path.

V1 excludes:

- User messages.
- Code blocks.
- Tool calls, tool results, tool-result images, and attachments.
- Unrecognized ordinary text, including a visually adjacent or split path.
- Other Markdown viewers outside Agent conversations.
- New copy-path, copy-link, application-picker, retry, or confirmation controls.
- Any change to existing left-click and `Enter` behavior.

## Interaction

Completed local-reference anchors use the existing shadcn/Radix context menu and default styling. The two items are always enabled and remain in the fixed order above:

- `使用默认应用打开` uses the existing Lucide external-open icon.
- `在文件夹中显示` uses the existing Lucide folder-location icon.

There is no separator, description, shortcut hint, custom color, visible button, or disabled-reason text. Opening the menu performs no filesystem access and makes no inference from the extension, trailing separator, or visible label.

The same menu opens from a pointer context click, the keyboard Context Menu key, or `Shift+F10` while the link is focused. Adding the menu trigger must preserve pointer text selection and copying for both path labels and aliases.

A streaming assistant message suppresses the Chromium native link context menu for a temporary recognized local reference and shows no replacement menu. Once the message completes, the two Agent actions become available. Context behavior for external links and unrelated content does not change.

Each explicit menu selection creates at most one operation and one operating-system call. There is no automatic retry. Selecting the item again is a new user operation.

Success has no Toast and does not claim that an external application started, loaded, focused, selected, or displayed anything. Expected failure and IPC rejection use only:

- `打开失败`
- `在文件夹中显示失败`

The Renderer never displays a path, policy detail, native error, or stable internal error code.

## Reference contract

The action uses only the anchor's exact `data-reference`; it never reconstructs a target from visible text or adjacent content. Existing left-click reference parsing remains the semantic source:

- A relative reference is resolved at action time against the conversation project's current root.
- An absolute reference remains absolute.
- A normalized relative reference may leave the project root, but the resulting absolute and real paths receive the full outside-userdata permission and audit checks.
- A `:line:column`, `#Lline`, or other existing recognized position suffix is removed for these two actions. Left click keeps its position-aware behavior.
- If the project no longer exists, cannot be resolved, or its current root no longer contains the target, the action fails.

The IPC reference is limited to 4096 Unicode code points. An over-limit value is rejected before path parsing or filesystem access, is not truncated or repaired, and is never logged.

Right-click actions validate native absolute-path semantics for the current platform. A path that is visibly absolute for another platform fails and is never joined to the current project root. macOS and Windows native forms are formally supported:

- Windows accepts normal drive-qualified absolute paths and standard UNC `\\server\share\...` paths.
- Windows rejects device namespace forms such as `\\?\C:\...`, `\\.\...`, and `\??\...`.
- Windows rejects NTFS alternate data streams. The drive separator is the only path colon; a numeric location suffix already removed by the shared parser is not part of the path.
- Linux retains platform-neutral implementation and unit coverage but is not a V1 acceptance platform.

## Operation boundaries

The existing position-aware `agent.openReference` remains unchanged. V1 introduces two independent Agent operations rather than a shared mode switch:

| Operation | Bridge |
| --- | --- |
| `app.agent.reference.open_default` | `agent.openReferenceDefault({ projectId, reference })` |
| `app.agent.reference.show_in_folder` | `agent.showReferenceInFolder({ projectId, reference })` |

Requests strictly contain only `projectId` and `reference`. Responses use:

```ts
type AgentReferenceActionResult =
  | { ok: true }
  | { ok: false; code: AgentReferenceActionErrorCode }
```

Neither response returns the parsed, normalized, or real path. The operations are Renderer IPC only: they do not register a capability, MCP tool, Workflow node, deep link, or generic Shell entry point.

Expected validation, permission, timeout, cancellation, race-detection, and native-call failures return the result union. Only IPC transport failures and true invariant failures reject the call. The global IPC error envelope is unchanged.

The fixed business error code set is:

```text
invalid_reference
foreign_platform_path
project_unavailable
not_found_or_inaccessible
unsupported_object_type
symbolic_link_not_supported
permission_denied
network_timeout
target_changed
no_parent_directory
system_rejected
system_failed
cancelled_before_submission
```

Over-limit input, device paths, alternate data streams, and malformed references map to `invalid_reference`. Permission response codes do not disclose which permission failed. Unknown failures must not be disguised as one of these business codes.

## Default application action

`使用默认应用打开` accepts an ordinary file or directory and submits that target to the operating system's native default-open behavior. A directory commonly opens in the file manager, while application packages and executable objects retain operating-system-defined behavior. V1 has no extension or executable-type blacklist because the user explicitly selected this side effect.

The target entry itself must not be a symbolic link, Windows Junction, or other redirecting Reparse Point. If only an ancestor redirects, the operation resolves the real target, repeats permission checks and auditing against the real path, and submits the real target.

Filesystem roots such as `/` and `C:\`, and UNC share roots, can be opened by this action.

## Folder-location action

`在文件夹中显示` asks the native file manager to show the target entry in its actual parent directory. It accepts:

- Ordinary files.
- Directories.
- Symbolic links, including dangling symbolic links.
- Windows Junctions and other redirecting Reparse Point entries.

The leaf entry is located without resolving or authorizing its target. If an ancestor redirects, the actual parent and entry location are resolved and rechecked. A filesystem root or UNC share root has no parent entry to locate and returns `no_parent_directory`; the action never falls back to merely opening that root.

## Object and race rules

Both actions reject FIFO, Unix Socket, character device, block device, and every other special entry. The default action supports only ordinary files and directories; the location action additionally supports the redirecting entries above.

Immediately before the native call, the main process repeats the relevant object-type, identity, real-path, and parent-resolution checks. If the target identity, type, or real location changed after authorization, the operation stops with `target_changed` and does not continue against the new target.

This is a best-effort time-of-check/time-of-use defense. It is not an atomic guarantee across processes.

## Permission and audit boundary

The click is authorized as an explicit user action. The message-generating Agent is not the actor and cannot trigger either operation by merely emitting a reference. Agent conversation permission modes, including skipped runtime confirmation, do not affect these actions. The main-process `PermissionGuard` remains authoritative and may allow, deny, or request its existing unified confirmation.

The default action checks, in order:

1. `fs.read.outside-userdata` for the surface path.
2. `fs.read.outside-userdata` again for the resolved real path.
3. `shell.exec` immediately before native submission.

The location action checks:

1. `fs.read.outside-userdata` for the target entry.
2. `fs.read.outside-userdata` for its actual parent directory.
3. `shell.exec` immediately before native submission.

It does not authorize a symbolic-link leaf target. Any denial stops the operation and never falls back to the generic Shell IPC.

For a standard UNC path, the main process first extracts the server/share boundary and checks and audits `network.connect` before any `lstat`, real-path lookup, or native operation. The remaining filesystem and Shell checks then run normally. UNC preflight has a fixed 10-second timeout. A timeout permanently ends that invocation even if an underlying filesystem request finishes later; local paths have no such timeout.

Permission audit records use the clicking user as Actor and identify the Agent reference-menu source, explicit operation, project needed for resolution, resolved target resource, and result. They do not contain a conversation id, message id, message content, or link text.

Failures before a trustworthy resource exists, including over-limit input, foreign-platform paths, Windows device paths, and alternate data streams, produce only a redacted structured diagnostic and no filesystem permission audit. Once a target resource is normalized, permission denials, object failures, race failures, and system failures are audited against the appropriate resource. A rejected UNC network permission receives its own normal audit.

Ordinary logs, diagnostics, tracking, and Toasts never record the path, link text, filename, extension, native error, or exception text. Permission audit is the only place where the resolved target resource may appear.

## Sender lifecycle

Before native submission, the operation observes the invoking IPC sender's lifecycle. If its window is destroyed during UNC or other preflight work, the operation returns `cancelled_before_submission` and never submits a late native call. Completed filesystem or network permission audits remain, but no successful or failed `shell.exec` audit is written because no system operation occurred.

A component rerender or conversation change does not cancel an already selected action. Once the operating-system call is submitted, it cannot be revoked. A destroyed Renderer has no Toast to display.

## System-call result semantics

Default open treats an empty native rejection string as an accepted request. A non-empty native rejection maps to `system_rejected`; an invocation failure maps to `system_failed`.

Folder location treats a normally returned native call as accepted and a thrown native failure as `system_failed`. Each invocation submits at most one native call and never retries.

`{ ok: true }` and the Renderer tracking result `accepted` mean only that validation, permission checks, final revalidation, and native submission acceptance completed. They do not mean that an external application completed an observable user outcome.

## Renderer telemetry

Each selection emits minimal non-content telemetry:

- Operation type.
- Message id.
- Message length.
- Reference length.
- `accepted`, one stable business error code, or Renderer-only `ipc_failure`.

Telemetry never includes a path, visible label, filename, extension, native error, or exception text. A rejected IPC is not parsed for a business code and always records `ipc_failure`.

## Architecture

The main process owns a dedicated Agent reference-action service. IPC handlers only validate the strict request envelope, resolve trusted caller/project context, and delegate. Renderer code never invokes a generic Shell bridge for either action.

The service may reuse shared path normalization, permission, audit, and redaction helpers, but it does not widen `FileOpenerService`. File Opener continues to accept only absolute, ordinary, non-symbolic-link files through its existing App, MCP, Workflow, and deep-link surfaces.

The shared Agent message component owns the context-menu rendering so the main conversation and detached conversation window remain behaviorally identical.

## Verification

Renderer tests cover:

- Included and excluded rendering scopes.
- Streaming native-menu suppression and completed-message enablement.
- Fixed menu order and icons.
- Pointer and keyboard menu access.
- Text selection and copying.
- Existing left-click and `Enter` behavior.
- Main and detached conversation consistency.
- Generic failure Toasts and telemetry redaction.

Main-process service and IPC tests cover:

- 4096-code-point input limit.
- Native, foreign-platform, Windows device, ADS, drive, and UNC path handling.
- Relative resolution against the current project root, including escape outside the root.
- Ordinary files, directories, roots, symbolic links, dangling links, Junction/Reparse Point behavior, and unsupported special entries.
- Real-path resolution and final identity/type/location revalidation.
- Permission order, audit resource and Actor, early unaudited failures, and redacted diagnostics.
- UNC `network.connect`, server/share scoping, 10-second timeout, late-completion suppression, and sender destruction.
- Stable business codes, unexpected rejection behavior, and exactly one native call.

Bridge and contract tests cover the two separate Agent IPC methods, strict requests, result union, absence of returned paths, and absence of a generic Shell or public capability surface.

Automated verification runs Renderer and main-process tests separately, desktop typecheck, IPC code generation checks, and hard-constraint checks without starting a development server. Platform acceptance includes macOS arm64 and Windows x64, including native path forms, UNC/drive differences, link/Reparse boundaries, and real native-call failure. Linux receives portable unit coverage only. Manual smoke testing supplements but never replaces automation.
