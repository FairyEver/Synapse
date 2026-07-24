# Clipboard Workflow Capability V1 Design

Status: implemented.

## Goal

Clipboard V1 adds two built-in Workflow nodes for the current operating system's standard clipboard:

- write plain text;
- read plain text.

It is a Workflow capability, not a general Clipboard product surface. V1 does not register a System App, MCP Tool, Automation Action, Deep Link, Renderer IPC, clipboard history, watcher, clear action, rich-format action, or platform-specific pasteboard target.

## Stable identities and surfaces

- Package ID: `clipboard`
- Package version: `1.0.0`
- Service ID: `core.clipboard`
- Write capability: `app.clipboard.text.write@1.0.0`
- Read capability: `app.clipboard.text.read@1.0.0`
- Write node type: `clipboard_text_write`
- Read node type: `clipboard_text_read`
- Write node title: `写入剪贴板`
- Read node title: `读取剪贴板`

Stable identities consistently use `write` and `read`; they do not mix `copy` or `paste`.

Both capabilities use `availability: "always"` and `userToggle: "none"`. Both Workflow nodes use `discovery: "visible"`. The package manifest declares `systemApp: null` and empty Automation, MCP, and Deep Link surfaces.

Capability catalog metadata is:

| Capability | mutates | risk |
| --- | --- | --- |
| `app.clipboard.text.read` | `false` | `high` |
| `app.clipboard.text.write` | `true` | `high` |

Neither capability declares a permission family or passes through PermissionGuard. Descriptions are limited to the standard system clipboard, plain text, the 1 MiB limit, and the Workflow-only surface.

## Native clipboard boundary

The only native adapter is an injectable main-process Electron adapter initialized after `app.whenReady()`. It uses only:

```ts
clipboard.readText()
clipboard.writeText(text)
```

Both calls target Electron's default standard clipboard. V1 does not use the Linux selection clipboard, macOS Find pasteboard, or platform-specific business branches. It does not inspect, preserve, merge, or expose HTML, RTF, images, or file lists.

`writeText(text)` runs exactly once. Existing non-text formats may be replaced or removed. Success guarantees only that the valid plain text was passed to `writeText()` and the synchronous call returned normally. It does not prove that other formats remain or that the value remains current after later external changes.

The service never reads back after writing, compares values, snapshots the old clipboard, restores a prior value, or performs a second audit. If native `writeText()` throws, the public result is `WRITE_FAILED` and clipboard state is unknown: it may be unchanged, partially changed, or fully changed.

The synchronous return also completes the contract for process lifetime. Synapse does not delay shutdown, retain a background process, register a Clipboard shutdown flush, or replay content after normal exit, crash, or forced termination. Whether written content survives process exit remains an operating-system and clipboard-manager behavior, not a cross-platform product guarantee.

## Shared plain-text validation

One shared validator is the authority for configured and runtime write text. It checks in order:

1. value is a string;
2. value is non-empty;
3. UTF-16 surrogate pairs are well formed;
4. U+0000 is absent;
5. UTF-8 size is at most 1 MiB (`1,048,576` bytes).

Surrogate validity is checked before `TextEncoder` counts bytes so replacement characters cannot hide invalid input. Valid text is not trimmed, newline-normalized, Unicode-normalized, truncated, or otherwise modified. Spaces, Tab, CR, LF, other valid Unicode control characters, combining characters, and emoji are preserved.

The read path reuses the string, Unicode, NUL, and UTF-8 checks but allows the empty string. A native read containing an unpaired surrogate or NUL fails as `READ_FAILED`; an oversized read fails as `TEXT_TOO_LARGE`. Read failures never return a prefix or partial value.

The 1 MiB read limit is an accepted Workflow-result boundary, not a pre-native memory quota. Electron `readText()` returns one complete string before Synapse can validate or count it, so an oversized native result may transiently allocate more memory. The service drops its business reference after rejection but does not probe native format size, stream chunks, start a Worker, or truncate the result. Verification must not claim that the limit prevents Electron or the operating system from creating an oversized transient string.

## Write node

Configuration is strict and exactly:

```ts
{
  text: string
  variables: VariableBinding[]
}
```

The config Schema applies the shared validator to the raw `text` template, so empty, invalid-Unicode, NUL-containing, or oversized templates cannot be saved. A non-empty whitespace-only template remains valid.

Execution:

1. checks `abortSignal`;
2. resolves existing explicit variable bindings;
3. calls `interpolatePromptSafely(text, resolvedVariables)`;
4. applies the shared validator to the final expanded text;
5. verifies trusted Workflow identity;
6. checks `abortSignal` again;
7. enters `core.clipboard`, crossing the acceptance point.

The `in` port controls ordering only. It never implicitly consumes an upstream primary output. Users bind upstream data explicitly through `variables`.

An unbound template variable returns sanitized `INVALID_INPUT` without `data`, variable name, or template fragment. A final empty string returns `INVALID_INPUT` with `{ field: "text", reason: "empty" }`. NUL returns `INVALID_INPUT` with `{ field: "text", reason: "forbidden_character" }`. Invalid Unicode and an oversized final result are also rejected before native access. These failures and pre-acceptance cancellation guarantee that the clipboard is unchanged.

Success returns:

```ts
// Primary output
{"success":true}

// Structured output
{ success: true }
```

The public structured output list is `["success"]`. No result contains the written text, length, hash, preview, previous value, or clipboard snapshot.

## Read node

Configuration is a strict empty object:

```ts
{}
```

Execution checks `abortSignal`, verifies trusted Workflow identity, checks `abortSignal` immediately before service entry, and then calls the shared service once.

An empty clipboard or clipboard containing only non-text formats succeeds:

```ts
// Primary output
""

// Structured output
{ text: "" }
```

For non-empty valid text, the primary output is the complete text and the structured output is `{ text }`. The public structured output list is `["text"]`.

## Ports, cards, and panels

Read ports:

- `in` / `输入`
- `out` / `文本`

Write ports:

- `in` / `输入`
- `out` / `结果`

Both nodes may be source nodes without incoming edges. They still follow the existing executable-graph rules: a source must reach End through outgoing edges; a leaf explicitly branched from the main path follows the existing side-effect-branch barrier; a fully disconnected node does not execute, audit, or access the clipboard. Clipboard adds no `alwaysRun`, implicit root, or node-type reachability list.

Both cards show only their title, with no subtitle, text preview, result preview, or content-derived summary.

The write node has one minimal dedicated panel:

- existing `CollapsibleSection` titled `文本`, containing the existing multiline `PromptEditor`;
- existing `CollapsibleSection` titled `输入映射`, containing `VariableBindingEditor`.

It has no explanation, preview, counter, test-write button, or save button. Validation appears through the existing Workflow validation area and never edits the user's input.

The read node registers no capability-specific panel and shows only generic node controls. The implementation uses existing components, theme tokens, and utility classes without custom styles or colors.

## Acceptance point and cancellation

The acceptance point is entry into the shared `core.clipboard` service.

- Cancellation before acceptance returns `CANCELLED`, maps to node `cancelled`, and performs no clipboard access or audit.
- After acceptance, the service executes one synchronous native operation and produces a fixed success or failure. Later cancellation cannot change it.
- Neither operation creates an undo handle, retry, rollback, lease, or cancellable native handle.

`workflowId`, `runId`, and `nodeId` must be non-empty trusted execution context. Missing identity returns `INTERNAL_ERROR` before acceptance without clipboard access, audit, or synthetic `unknown`/`anonymous` values.

All ordinary failures propagate through existing Workflow semantics. `INVALID_INPUT`, `TEXT_TOO_LARGE`, `READ_FAILED`, `WRITE_FAILED`, and `INTERNAL_ERROR` fail the Workflow; `CANCELLED` cancels it. Failure in a side-effect leaf still prevents successful End completion. V1 has no `continueOnError`, private error port, or Clipboard-specific degradation switch.

## Stable error contract

Every error output is:

```ts
{
  code: ClipboardErrorCode
  message: string
  retryable: false
  data?: {
    field: "request" | "text"
    reason:
      | "required"
      | "type"
      | "empty"
      | "invalid_unicode"
      | "forbidden_character"
      | "unknown_field"
  }
}
```

`data` exists only for `INVALID_INPUT`. Error codes are:

- `INVALID_INPUT`
- `TEXT_TOO_LARGE`
- `READ_FAILED`
- `WRITE_FAILED`
- `CANCELLED`
- `INTERNAL_ERROR`

Messages are fixed and never append native exceptions, input text, fragments, variable names, byte counts, or actual lengths. `retryable: false` means the node neither recommends nor automatically performs a retry; users may still rerun the Workflow.

## Core service and lifecycle

`core.clipboard` is a main-process singleton registered with the same interface on every startup after Electron is ready. It does not depend on WindowManager, Renderer, DataRepository, or IPC.

The service uses one injected adapter. Adapter initialization failure installs an unavailable adapter while retaining the same service registration:

- read returns `READ_FAILED`;
- write returns `WRITE_FAILED`;
- health is only `healthy` or `degraded: adapter_unavailable`.

AuditSink is an optional port and does not block service registration, startup, or calls. Workflow Engine startup depends on `core.clipboard`; both nodes resolve that same service instance.

There is no global queue, lock, lease, version, idempotency key, deduplication, compare-and-set, Clipboard-specific rate limiter, burst capacity, or cooldown. Each native call is a synchronous indivisible call. Independent nodes have no ordering guarantee; callers use explicit edges when order matters.

The service does not cache content, old values, or recent reads and writes. Complete text is referenced only by the current Workflow Engine and necessary downstream nodes. Business references are released after the run and JavaScript GC controls reclamation. V1 does not claim deterministic memory zeroization, process-dump erasure, or system-clipboard erasure.

## Authorization, sharing, and Agent intent

Explicitly authoring and running or enabling a Workflow containing Clipboard nodes is authorization. Clipboard adds no PermissionGuard check or per-run prompt.

Existing Workflow UI, Workflow MCP, Automation execution, and `workflow_call` use the same node semantics. Workflow MCP may create, update, inspect, and run Workflows containing Clipboard nodes; it is not a dedicated Clipboard MCP surface.

The built-in Workflow Skill must state that an Agent may add or trigger either node only when the user currently and explicitly asks to create or run a clipboard Workflow. It must not read the clipboard for an ordinary answer, environment check, or context gathering. A future dedicated Clipboard MCP Tool requires a separate authorization design.

Share contracts for both nodes use:

```ts
{
  selfContained: false,
  capability: {
    id: "<corresponding capability ID>",
    minVersion: "1.0.0",
    installSourceId: "synapse.builtin"
  }
}
```

Missing or incompatible capabilities use the existing import compatibility blocker. Imports do not downgrade nodes into text nodes or executable shells.

The whole read node declares high-risk `clipboard.read`. The whole write node declares high-risk `clipboard.write`. Write config path `text` is sensitive; exports warn but do not redact it. `variables` stores references only and is not sensitive. The read node has no persisted content field to mark sensitive.

Parent exports recursively include child Workflows and aggregate both capabilities, both risks, and write `text` sensitive locations. Import preview locates the actual child Workflow and node. Parents continue calling the latest child version under existing `workflow_call` semantics without Clipboard-specific pinning or confirmation.

## Audit

`PermissionAction` gains `clipboard.read` and `clipboard.write` for audit typing only. They are not registered with PermissionGuard.

Each accepted operation attempts exactly one audit after its native outcome is known:

- action: `clipboard.read` or `clipboard.write`;
- resource: corresponding stable Capability ID;
- outcome: `allowed` on success, `failed` on native failure or post-read validation failure;
- failed metadata adds only the stable `errorCode`.

Metadata contains only:

```ts
{
  source: "workflow"
  workflowId: string
  runId: string
  nodeId: string
}
```

The top-level actor comes from Workflow Engine and falls back to `{ kind: "system", id: "workflow-engine" }`. Nested execution records the actual child Workflow and node. Clipboard audit does not add trigger source, MCP client/controller, Automation identity, parent call stack, names, content, preview, summary, hash, or byte length. Entry-channel differences remain in existing outer Workflow audit.

Input rejection and pre-acceptance cancellation do not audit. Read oversize, invalid Unicode, or NUL happen after native access and therefore audit failed. AuditSink absence or failure changes neither the clipboard result nor the node result and does not retry.

## Logging

The logger name is `core.clipboard`. It does not log per-call success, input rejection, cancellation, read oversize, content, derived content, byte length, actor, Workflow identity, node identity, or native exception details.

Warnings are limited to adapter initialization, native read/write exceptions, invalid Unicode returned by native read, and AuditSink failure. Structured fields are limited to:

```ts
stage:
  | "adapter_init"
  | "clipboard_read"
  | "clipboard_write"
  | "audit_record"

reason:
  | "adapter_unavailable"
  | "native_exception"
  | "invalid_unicode"
  | "sink_unavailable"
  | "sink_failure"
```

V1 adds no success metric, counter, aggregator, or Clipboard-specific telemetry. Health exposes no native exception.

Existing Workflow Engine lifecycle logs remain unchanged for Clipboard nodes. They may retain the same generic run/node identity, node type/name, variable-key, and variable-count diagnostics used for other nodes, but never variable values. Clipboard does not add content, preview, hash, actual byte length, or expanded-text length to those logs. Native exceptions are converted to fixed Clipboard reasons before an error can reach generic Workflow logging.

## Runtime and persisted data

The Workflow Engine and downstream data flow retain the complete valid read value, up to 1 MiB.

Renderer events, run status, and Workflow MCP status/results use the existing approximately 10,000-byte bounded preview and standard truncation marker. Clipboard adds no full-text reveal, download, or IPC.

Persisted run snapshots always omit the read node's `output` and `outputs.text`, retaining status, timing, and stable errors. This omission happens only at the persistence boundary; implementation must not clear Engine data or the live bounded preview.

The write node's expanded text and runtime variable values exist only during execution. Live events, status, Workflow MCP results, and persisted node results fix write `input` to:

```ts
{ variables: {} }
```

The run snapshot's embedded Workflow definition still retains the author's already-persisted raw `text` template and variable references to preserve historical structure and existing rerun semantics. Share export also retains `text` with its sensitive warning.

V1 does not track sensitive data after a user explicitly passes read output into another node. Downstream persistence follows the downstream node's existing rules.

## Schema and catalog evolution

Workflow document Schema advances from `2.8.0` to `2.9.0` with:

- an empty `2.8.0 -> 2.9.0` migration;
- a `2.9.0` historical fixture;
- both Clipboard nodes in contract fixtures;
- migration and contract test updates.

Implementation must preserve and build on the existing parallel uncommitted `2.8.0` work. Workflow share package remains `4.0.0`; required capabilities express both `>= 1.0.0` dependencies. Workflow revision hashing and DataRepository envelope versions do not change.

Implementation updates `AGENTS.md`:

- add Clipboard with Workflow count `2` and all other surfaces `—`;
- app domain `60 / 58` to `62 / 58`;
- total `208 / 206` to `210 / 206`;
- capability-without-MCP exceptions from two to four by adding both Clipboard capabilities.

## Documentation

The implementation updates:

- this design;
- `CONTEXT.md`;
- the two Clipboard ADRs;
- `AGENTS.md`;
- built-in Workflow Skill `index.md` and `api-reference.md`;
- `RELEASE_NOTES_PENDING.md` under `新增功能`.

Website docs, `CHANGELOG.md`, and product version changes remain part of the formal release process.

## Verification

Default automated tests never read or write the real system clipboard.

Coverage includes:

- shared validation: type, empty, whitespace, NUL, surrogate validity, exact 1 MiB UTF-8 boundary;
- injected adapter/service: one native call, unavailable adapter, native exceptions, cancellation boundary, audit outcome, and log redaction;
- Workflow: interpolation, explicit bindings, ports, outputs, failure propagation, live bounded preview, persisted read omission, and write input omission;
- registration and contracts: package manifest, Capability catalog, share risks and sensitive paths, nested `workflow_call`, and Schema 2.9.0 migration/fixtures;
- Renderer: minimal write panel and no read-specific panel.

Before release, macOS, Windows, and Linux each receive one manual smoke test against the default standard clipboard. The tester saves the old plain text and best-effort restores it afterward. Test restoration is not product behavior, and restoration failure does not change the runtime contract.

## V1 non-goals

V1 does not include:

- System App, dedicated MCP Tool, Automation Action, Deep Link, or Renderer IPC;
- clear clipboard;
- rich text, HTML, RTF, image, file-list, or multi-format preservation;
- Linux selection, macOS Find pasteboard, or caller-selected clipboard target;
- clipboard history, watcher, polling, change event, version, compare-and-set, transaction, or rollback;
- permission prompt, PermissionGuard policy, per-run confirmation, source-specific execution behavior, or dedicated rate limiting;
- read truncation at the Engine boundary, partial read, write verification, retry, deduplication, or idempotency;
- content preview on node cards, read settings panel, test-write UI, save-content switch, full-output reveal, or download;
- cross-node sensitive-data tracking, deterministic memory erasure, crash-dump erasure, or operating-system clipboard erasure;
- Clipboard-specific error continuation or failure ports.
