# JSON Repair V1 Design

Status: confirmed and implemented.

## Product identity

- Display name: `JSON Repair`
- App ID: `json-repair`
- Namespace: `json_repair`
- Service ID: `core.json-repair`
- Capability: `app.json_repair.text.repair@1.0.0`
- PermissionAction: `json.repair`
- MCP tool: `app_json_repair_text_repair`
- Workflow node type: `json_repair_text_repair`
- Chinese action and node name: `JSON 修复`

The capability is a pure, non-mutating, normal-risk transformation. It does not use PermissionGuard and is not high risk.

## Stable request and result

The only request is:

```ts
{ text: string }
```

`text` is required, non-blank, well-formed UTF-16, preserved as supplied, and limited to 128 KiB (131,072 bytes) as UTF-8. Multiline and control content are allowed. Unknown fields are rejected. JSON Schema `maxLength` is only a coarse prefilter; the runtime UTF-8 byte count is authoritative.

The only successful public result is:

```ts
{ json: string }
```

`json` is complete repaired text that has passed final `JSON.parse` validation, the non-finite-number check, the output byte limit, and the nesting limit. This string is authoritative. The parsed JavaScript value never crosses UI, IPC, MCP, or Workflow boundaries and is never serialized back over the repaired text.

## Single-result semantics

One request returns at most one JSON text result.

- The whole input may produce any JSON root value.
- Embedded ordinary text contributes only object or array candidates.
- Embedded scalar-looking prose is not extracted.
- Multiple embedded candidates are tried in source order. The first candidate that completes all gates wins.
- A failed candidate does not block later candidates unless it hits a call-wide resource limit.
- A whole-input NDJSON or multi-root sequence may be repaired by the upstream library into one array result. This remains one API result, not batch extraction.

## Ordered repair pipeline

1. Validate the request, authoritative input byte limit, and pre-acceptance cancellation.
2. Deterministically unwrap one narrow Markdown wrapper when present.
3. Run the whole text through upstream `repairJson`, then the shared output gates.
4. If unsuccessful, call upstream `stripLlmWrapper`; run its result through `repairJson` and the same gates.
5. If still unsuccessful, call upstream `extractAllJson` on the Markdown-unwrapped source and try its object/array candidates in source order through `repairJson` and the same gates.
6. Return the first success or the stable terminal error.

Synapse directly reuses `repairJson`, `stripLlmWrapper`, and `extractAllJson`. It does not directly call `preprocessJson`, `extractJson`, `containsJson`, or the streaming and incremental APIs. JSONP, MongoDB wrappers, comments, missing closings, unquoted keys, single quotes, Python constants, string concatenation, fenced input, and multi-root behavior remain upstream `repairJson` responsibilities.

Exact duplicate stage text may be skipped by string equality without changing source order or public semantics.

## Narrow Markdown wrapper

Synapse explicitly unwraps only one complete outer fenced block after disregarding outer whitespace:

- The opening line is exactly three backticks, optionally followed by case-insensitive `json`.
- The opening line is followed by LF or CRLF.
- The closing line is an independent three-backtick line.
- The captured body is preserved without trimming or newline normalization.

Language tags other than `json`, attributes, indentation, tilde fences, multiple blocks, and incomplete fences are not explicitly handled or rejected. They enter the upstream best-effort pipeline unchanged.

## Output gates

Every repaired stage output is checked before `JSON.parse` in this order:

1. UTF-8 output is at most 1 MiB.
2. Object and array nesting is at most 128 levels.
3. `JSON.parse` succeeds.
4. The parsed root and every nested number are finite.

The size and depth checks are call-wide resource failures and stop immediately. They never truncate, return partial output, or continue to another candidate.

The depth scanner is a pure, string-aware resource counter. A root object or array has depth 1 and a scalar has depth 0. Brackets inside strings and escaped quotes do not affect the count. It does not repair, extract, or decide JSON validity. V1 has no separate node-count limit.

Parse failure and non-finite numbers reject only the current candidate. If no candidate succeeds, terminal precedence is:

1. `NON_FINITE_NUMBER` if any candidate parsed into a value containing a non-finite number.
2. `JSON_REPAIR_FAILED` if extraction found an object/array candidate or any upstream function threw.
3. `NO_JSON_FOUND`.

Upstream exceptions are sanitized stage failures and do not become `INTERNAL_ERROR`. `INTERNAL_ERROR` is reserved for a Synapse invariant failure or an otherwise unclassified defect.

## Trust boundary

Successful output guarantees only:

- Synapse did not execute the input.
- The returned text passed final JSON parsing.
- The parsed result remained inside the JSON data type closure and contained only finite numbers.
- The complete returned text stayed within fixed resource limits.

Successful output does not guarantee:

- business or semantic correctness;
- sanitization or content safety;
- Schema compliance;
- downstream-safe object merging;
- trustworthy keys or values.

All legal keys and values are preserved, including `__proto__`, `constructor`, and `prototype`. Internal code must treat the result as untrusted data and must not merge it into configuration objects or execute it.

## Stable errors

All failures serialize as:

```ts
{
  code: JsonRepairErrorCode
  message: string
  retryable: false
  data?: {
    field: "request" | "text"
    reason: "required" | "type" | "empty" | "invalid_unicode" | "unknown_field"
  }
}
```

`data` exists only for `INVALID_INPUT`.

| Code | Fixed message |
| --- | --- |
| `INVALID_INPUT` | `JSON 修复输入无效。` |
| `INPUT_TOO_LARGE` | `输入文本超过 128 KiB 限制。` |
| `OUTPUT_TOO_LARGE` | `修复后的 JSON 文本超过 1 MiB 限制。` |
| `MAX_DEPTH_EXCEEDED` | `修复后的 JSON 嵌套超过 128 层限制。` |
| `NO_JSON_FOUND` | `未找到可修复的 JSON 数据。` |
| `JSON_REPAIR_FAILED` | `无法产出有效的 JSON 文本。` |
| `NON_FINITE_NUMBER` | `JSON 包含非有限数值。` |
| `CANCELLED` | `JSON 修复已取消。` |
| `INTERNAL_ERROR` | `JSON 修复失败。` |

No surface appends a field name, reason, size, depth, candidate count, parse position, native `SyntaxError`, upstream exception text, input, output, or candidate fragment.

## Core service and dependency

`@synapse/desktop` has an exact production dependency on `repair-json-stream@1.3.1`. It does not use a semver range, Git URL, copied source, or fallback repairer. Synapse imports the public package exports. Upgrades require manual source and changelog review, the fixed compatibility corpus, contract tests, and packaged Electron module-resolution smoke coverage. Distribution retains the upstream MIT notice.

`core.json-repair` is a stateless synchronous main-process service:

- `criticality: "degraded"`
- no hard dependencies;
- soft start ordering after `core.audit-sink`;
- optional AuditSink and sanitized logger;
- no dependency on Database, DataRepository, PermissionGuard, WindowManager, network, storage, or Renderer;
- no Worker, queue, fake timeout, background task, retry, runtime fallback, or meaningful start/stop/reload/health hook.

The Database/MCP aggregate service and Workflow Engine hard-depend on `core.json-repair`. IPC resolves the same instance after global service startup.

The upstream package and exports are build invariants. Missing or incompatible exports fail typecheck, tests, build, or packaged smoke rather than selecting a second implementation at runtime.

## Audit and logging

Each call that enters `core.json-repair` attempts exactly one audit record:

- action: `json.repair`
- resource: `app.json_repair.text.repair`
- outcome: `allowed` on success or `failed` on processing failure

Validation rejection, input-size rejection, and cancellation before the acceptance point are not audited. Metadata contains only trusted source identity, input byte count, successful output byte count, or stable failure code. MCP may add trusted client/controller identity; Workflow may add workflow/run/node IDs.

Audit and ordinary logs never contain input, output, candidates, repaired fragments, hashes, parsing positions, workflow names, or raw errors. AuditSink absence or write failure does not change the repair result and does not retry. The service does not log per-call success.

## System App

The App is visible in the launcher, openable, not pinned to Dock by default, and may be pinned by the user. Dock order is provisionally 244 and must be rechecked against the registry during implementation; an order conflict changes only that display number.

The App uses the shared system-App bounds (1180×760, minimum 960×640) and the existing App-ID-keyed single-instance window service. Reopening focuses the existing window. It declares no deep links or open parameters. MCP and Workflow never open, focus, or wake the window.

The App is non-removable, non-renameable, and has no editable icon.

### Workbench

The App uses one responsive view with no tabs:

- Wide windows place “输入文本” and “JSON 文本” side by side.
- Narrow windows stack the same fields.
- Both use monospaced existing Textarea components.
- Input shows its UTF-8 byte count.
- Blank input or input above 128 KiB disables “修复 JSON”.
- Editing input clears the prior result and prior error.
- Processing disables the input and primary action and shows the necessary busy state.
- There is no cancellation action after dispatch.
- The output is read-only and has no title-repeating empty placeholder.
- “复制 JSON” appears in the shared top bar only when a successful result exists.
- Failure shows only the shared fixed message in the existing Alert component.

The workbench uses existing shadcn components, theme tokens, layout utilities, and `SystemAppWindowShell`. It has no custom colors or styles, nested cards, explanatory copy, or decorative icon on the primary button.

### Icon

The App owns a 256×256 RGBA PNG whose readable subject is paired braces with a simple connecting repair relationship. It uses no text, gradient, shield, check, broom, sparkle, or file outline. Implementation checks the asset at 32, 64, and 256 pixels.

The Workflow node uses Lucide `Braces`. The copy action uses the existing `Copy` icon.

## IPC

There is one invoke surface:

- module: `jsonRepair`
- method: `repairText`
- operation: `app.json_repair.text.repair`
- bridge: `window.synapse.jsonRepair.text.repair({ text })`
- events: none

The public bridge type is strict. The IPC descriptor accepts an unknown transport payload because the current registry would otherwise throw a generic pre-handler validation error. The handler immediately invokes the shared domain validator so malformed calls receive the shared `INVALID_INPUT` contract. It adds only trusted UI actor/source and invokes `core.json-repair`.

IPC returns `{ ok: true, result: { json } }` or `{ ok: false, error }`. Sender destruction is observed before the acceptance point and maps to `CANCELLED`; once the synchronous core starts, cancellation cannot revoke it. The global IPC runtime is unchanged.

## MCP

The single tool is `app_json_repair_text_repair`.

- Input JSON Schema requires only `text`, uses `additionalProperties: false`, and declares `minLength: 1` and coarse `maxLength: 131072`.
- Runtime validation remains authoritative for UTF-8 bytes and all other rules.
- Success exposes only `{ json }`; no `affected`.
- Failure is `isError: true` and uses the shared serialized error.
- The descriptor says repair is best-effort, may heuristically change meaning, performs final JSON validation, and does not establish trust, sanitization, or Schema compliance.

Agents call it only when the user explicitly wants JSON repair or the current task explicitly requires converting damaged JSON into consumable text. They pass the original text once, do not pre-clean it, do not parse and reserialize the result, do not use it as a security or Schema tool, and do not retry automatically.

V1 does not split extract, validate, pretty-print, file, or batch tools.

## Workflow

The node type is `json_repair_text_repair`, titled “JSON 修复”, with fixed ports `in`/“输入” and `out`/“JSON”.

Configuration is exactly:

```ts
{
  text: string
  variables: VariableBinding[]
}
```

The panel reuses `PromptEditor` and `VariableBindingEditor`. Save validation rejects blank text and the existing Workflow validator rejects unbound variables. Runtime execution:

1. checks `abortSignal`;
2. resolves bindings and calls the existing no-content-log safe interpolation entry;
3. invokes the shared JSON Repair input validator;
4. checks `abortSignal` again;
5. enters the non-cancellable core service.

Success uses `json` as the primary string output and `{ json }` as structured output. Failure uses an empty primary output and the shared error payload; cancellation uses the shared cancellation contract. Card, logs, errors, and run presentation never show input text or variable values.

The card shows only the configured node title. Sharing declares only:

```text
app.json_repair.text.repair >= 1.0.0
```

It declares no resource, model, project, sensitive field, or high-risk permission. The Workflow document Schema advances to the next unused minor, currently expected to be 2.7.0, with an empty migration, historical fixture, and schema-contract update. Implementation must recheck that version. The share-package format remains 4.0.0.

The direct-Agent MCP intent restriction does not apply when a Workflow author explicitly configures this node.

## Synapse Skill documentation

Runtime registration, tool catalog, built-in Synapse Skill guidance, App API reference, Workflow guide/reference, and their contract tests ship together.

The direct-tool guide records the explicit intent boundary, original-input rule, authoritative text result, no automatic retry, and trust limitations. The API reference records limits, ordered semantics, result, and stable errors. Workflow documentation records node config, bindings, interpolation, output, and capability dependency. Documentation must not claim that the tool exists before its runtime registration is included.

## V1 non-goals

V1 does not include:

- batch input or multiple returned results;
- caller-selected candidate order or strategy;
- scalar extraction from surrounding prose;
- separate extract, validate, pretty-print, file, or batch APIs;
- formatting, canonicalization, parse-tree output, or native JavaScript output;
- Schema input or Schema validation;
- semantic correctness, trust scoring, sanitization, content filtering, or dangerous-key deletion;
- output truncation, partial success, or fallback to a later candidate after a resource failure;
- node-count limits;
- Worker isolation, queues, timeouts, or cancellation after core acceptance;
- PermissionGuard, high-risk classification, or per-call confirmation;
- file picker, file reading/writing, drag and drop, history, diff, examples, or repair-action details;
- tabs, settings, feature flags, deep links, IPC events, or a standalone HTTP/CLI surface;
- window activation from MCP or Workflow;
- use of `containsJson`, upstream streaming/incremental APIs, copied upstream internals, automatic dependency upgrades, or a runtime fallback repairer;
- content-bearing audit, logs, diagnostics, or UI errors.

## Implementation scope

Implementation is limited to:

1. Add the exact desktop dependency and MIT notice handling.
2. Add one `json-repair` App capability package with shared identity, validation, errors, manifest, main service/dispatcher/IPC, Renderer, Workflow node, tests, and icon.
3. Register the capability, dispatcher, service descriptor, IPC module, preload bridge, Renderer bridge types, App definition/manifest/content, and Workflow node.
4. Add `json.repair` to the canonical PermissionAction vocabulary for audit typing only.
5. Update MCP catalog/tool descriptors and action routing.
6. Advance the Workflow document minor with its empty migration, fixture, schema contract, and share-capability coverage.
7. Update built-in Synapse Skill App and Workflow documentation.
8. Add the accepted core, resource, error, privacy, audit, IPC, MCP, Workflow, Renderer, registry, documentation, icon, build, and packaged-resolution verification.

## Acceptance

The fixed compatibility corpus covers the upstream behaviors Synapse relies on without copying the upstream suite. Boundary tests cover input validation order, 128 KiB input, 1 MiB output, 128-level nesting, string-aware counting, non-finite numbers, large-integer text preservation, legal dangerous-looking keys, candidate order, terminal error precedence, upstream exceptions, and near-limit damaged inputs without flaky timing assertions.

Surface tests cover shared error serialization, audit and log redaction, optional AuditSink behavior, IPC cancellation and wide transport, MCP descriptor/normalization, Workflow config/interpolation/cancellation/output/share, Renderer state, App/Dock/deep-link registration, service dependencies, Workflow migration/fixtures/schema contract, Synapse Skill documentation, icon dimensions/readability, full desktop tests, typecheck, build, and packaged Electron resolution of `repair-json-stream`.
