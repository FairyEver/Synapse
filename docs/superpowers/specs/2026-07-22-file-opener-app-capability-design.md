# File Opener App Capability Design

## Goal

Promote the unreleased default-application Workflow node into a built-in File Opener application capability package. One shared service opens an existing local file with the operating system default application and is reachable from the system app, MCP, Workflow, and explicitly declared Synapse application deep links.

## Stable identities

| Surface | Identity |
| --- | --- |
| System app id | `file-opener` |
| App namespace | `file_opener` |
| Capability id | `app.file_opener.file.open` |
| MCP tool | `app_file_opener_file_open` |
| Deep-link action | `open` |
| Workflow node type | `file_opener_file_open` |
| Workflow share requirement | `app.file_opener.file.open@1.0.0` |

All public capability inputs use `{ path }`. The unreleased `open_file`, `filePath`, and `workflow.node.open_file` contracts are replaced rather than migrated or aliased.

## File-open contract

- Accept exactly one existing local absolute path.
- Require a regular non-symbolic-link file.
- Reject relative paths, directories, `file://`, HTTP/HTTPS URLs, multiple files, and application selection.
- Do not restrict extensions.
- Treat an empty `shell.openPath()` result as an accepted operating-system request.
- Return only `{ path }`.
- Do not claim that the external application started, focused, or loaded the file.

`FileOpenerService.open()` owns input validation, filesystem validation, permission checks, audit records, `shell.openPath()`, error sanitization, and stable error codes. IPC, MCP, Workflow, and deep-link adapters only provide the input and actor/source context.

Stable service errors are `invalid_path`, `file_not_found_or_inaccessible`, `symbolic_link_not_supported`, `not_regular_file`, `permission_denied`, `system_rejected`, and `open_failed`.

## Application deep links

The generic frame is:

```text
synapse://app/<app-id>/<action>?<params>
```

File Opener uses:

```text
synapse://app/file-opener/open?path=<percent-encoded-absolute-path>
```

The host must be `app`; the path must contain exactly the application id and Action; credentials, port, and fragment are rejected. File Opener accepts exactly one non-empty `path` parameter and rejects duplicates and unknown parameters. URL decoding occurs once before the shared capability schema runs.

A main-process-safe application capability manifest must explicitly expose every deep-link Action through `deepLinks`, mapping Action to capability id and query schema. Registering an app, capability, MCP tool, or Workflow node never exposes a deep link automatically. The generic protocol router parses and dispatches through the manifest registry and shared Action Router; it must not contain a File Opener branch. Existing auth, update, and Skill-install protocol routes remain independent.

App deep links are deliberately handwritten, unsigned, long-lived, and execute without a Synapse confirmation, Origin check, source check, caller-trust check, Intent token, replay guard, deduplication, or deep-link-specific rate limit. Each accepted event executes once in arrival order; one failure does not block later events. This is an explicit product boundary, not an omitted future task.

Successful hot and cold invocations do not create or focus the Synapse main window. Invalid app/action/input or execution failure also does not open the main window; it shows one sanitized native error and writes structured diagnostics without the raw URL. There is no browser callback.

After release, an app-id/Action pair and its existing parameter semantics are stable. Breaking changes require a new Action while the old Action remains available. The current unreleased baseline may be replaced in place.

## System app

File Opener appears in the system app launcher, can be pinned manually, is not pinned by default, uses dock order `242`, and opens in an independent system app window. Its 256 by 256 RGBA PNG icon uses a file and outward-open visual with no text, gradient, or decoration.

The test surface uses `SystemAppWindowShell` and one narrow centered task card. It contains only a labelled path input and an `打开` submit button. Enter submits. The form is disabled while running, preserves the path after success, and shows only the necessary success or error state. It has no picker, drag and drop, history, recent files, or explanatory copy.

## Workflow baseline replacement

Move the node into `desktop/app-capabilities/file-opener/workflow-node/` with type `file_opener_file_open` and configuration `{ path, variables }`. The node calls the shared File Opener service and returns the path as both primary and structured output.

The node was never formally released. Replace the current Workflow 2.3.0 contract and fixture in place without changing `WORKFLOW_SCHEMA_VERSION`, adding a migration, or retaining old registration. The only persisted repository workflow using the old node is `open-file-workflow` in the 2.3.0 schema fixture; implementation is incomplete until it is updated and verified through the Workflow engine with the shared File Opener service.

## Platform and verification

macOS and Windows are supported. Cover macOS `open-url`, Windows second-instance arguments, hot and cold start, strict routing, sequential failure isolation, service error paths, all four adapters, system app UI, application/capability/MCP/manifest registration, Workflow schema/share/runtime, and the unique fixture workflow. Linux retains the platform-neutral Electron path without a formal claim in this change.

Run targeted tests, the full desktop test suite, desktop typecheck, IPC codegen verification, and hard-constraint checks. Do not start a development server for verification. A formal Windows package release still requires packaged protocol-registration, cold-start, and hot-start smoke.

## Documentation

Update the repository rules, domain glossary, ADRs, Synapse Skill App and Workflow guides/API references, capability naming matrices and website mirrors, a public File Opener guide with macOS/Windows/HTML examples, and pending release notes. Documentation must state that paths are URL encoded, files must exist on the receiving machine, and App deep links have no Synapse confirmation, signature, Origin, source, or caller-trust validation.
