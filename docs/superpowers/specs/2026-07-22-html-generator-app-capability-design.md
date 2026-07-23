# HTML Generator App Capability Design

Date: 2026-07-22

## Goal

Add a built-in `html-generator` system App whose shared core renders a trusted EJS template string with structured JSON data. It replaces workflows that ask an AI Agent to write an entire HTML document directly with a fixed rendering pipeline. The same package exposes one string-returning capability and one composed file-generation capability to App UI, MCP, and Workflow.

“Stable generation” means fixed EJS semantics, strict inputs, bounded Worker execution, normalized failures, and reliable file persistence. It is not a sandbox, an HTML validator, or a reproducible-build guarantee.

## Stable identities

| Surface | String generation | File generation |
| --- | --- | --- |
| Capability | `app.html_generator.ejs.generate` | `app.html_generator.ejs_file.generate` |
| MCP tool | `app_html_generator_ejs_generate` | `app_html_generator_ejs_file_generate` |
| Workflow node | `html_generator_ejs_generate` | `html_generator_ejs_file_generate` |
| Capability version | `1.0.0` | `1.0.0` |
| Mutates | `false` | `true` |
| Risk | `high` | `high` |

The only system App id is `html-generator`. `ejs_file` means “generate an HTML file through EJS”; the first version does not read `.ejs` files. Neither public entry uses a `mode` field.

`mutates: false` describes only the behavior supplied by the string entry: HTML Generator does not call Writer, open a file, or initiate another system operation. Executable template code may still access files, networks, environment state, or other Worker runtime capabilities under the existing `shell.exec` code-execution boundary. It is not a purity guarantee.

## Public contracts

String generation request:

```ts
{
  template: string
  data: Record<string, JsonValue>
}
```

String generation result:

```ts
{
  html: string
  size: number
}
```

File generation request:

```ts
{
  template: string
  data: Record<string, JsonValue>
  outputPath: string
  overwrite?: boolean
}
```

File generation result:

```ts
{
  output: {
    path: string
    fileName: string
    format: "html" | "htm"
    encoding: "utf8"
    size: number
    overwritten: boolean
  }
}
```

All request schemas are strict and reject unknown fields. `template` has at least one character; whitespace-only templates are valid. `data` may be empty but must be a top-level ordinary JSON object. `overwrite` defaults to false. File generation accepts only a current-OS absolute `.html` or `.htm` output path, matched case-insensitively. It exposes no `templatePath`, `dataPath`, `encoding`, EJS options, or dynamic template mode.

Every `size` is a UTF-8 byte count. String generation returns the complete render result. File generation retains the HTML only long enough to pass it to Writer and returns no duplicate body. Neither result adds timestamps or template/data digests.

“Complete HTML” means untruncated EJS output, not a structurally complete HTML document. Empty strings, whitespace-only output, fragments, and full documents are all valid. The generator does not require or insert a doctype, `html`, `head`, `body`, newline, final newline, or charset declaration.

## Non-goals

- No custom Mustache-like language or EJS-compatible parser.
- No untrusted or upstream-replaceable Workflow template in the first version.
- No EJS template file loading, include, partial, or caller-supplied option.
- No generic `validate` capability, Tool, node, or tab.
- No HTML parsing, repair, lint, sanitation, accessibility check, standards check, browser compatibility check, preview, open, reveal, or execution.
- No App deep link, template/data picker, drag and drop, clipboard auto-read, remote import, template asset, history, autosave, crash recovery, or DataRepository namespace.
- No CodeMirror, syntax highlighting, completion, formatting, line numbers, or editor-specific dependency.
- No caller-selectable timeout, memory, concurrency, queue, or encoding setting.
- No OS child process or claimed security sandbox.
- No first-version Linux release commitment.

## EJS execution contract

Desktop adds the exact direct runtime dependency `ejs: "6.0.1"`. It does not reuse electron-builder's transitive EJS, use a caret range, or add the stale `@types/ejs` package. A project-owned narrow type wrapper exposes only the internal compile-and-execute operation required by the Worker.

The Worker calls `ejs.compile(template, fixedOptions)` and then invokes the returned function with detached data. Compile parsing, code generation, or `Function` construction failures become `TEMPLATE_COMPILE_FAILED`. Execution failures, including a template-thrown `SyntaxError`, become `RENDER_FAILED`. Compilation artifacts live only in the one-shot Worker and are never cached or exposed.

The semantic option matrix is fixed:

```ts
{
  _with: false,
  strict: true,
  localsName: "data",
  delimiter: "%",
  openDelimiter: "<",
  closeDelimiter: ">",
  async: false,
  compileDebug: true,
  debug: false,
  rmWhitespace: false,
  cache: false,
  filename: false,
  root: [],
  views: [],
  includer: disabledIncluder,
  escape: ejs.escapeXML,
  context: undefined,
  outputFunctionName: undefined,
  destructuredLocals: undefined,
  unsafePrototypeLocals: false,
  legacyInclude: false,
}
```

Client compilation is semantically disabled. EJS 6.0.1 does not read a `client` option, so the implementation omits the ineffective property and enforces the synchronous string-returning surface through the wrapper. Templates use `data.title`, `data.items`, and other explicit paths; top-level keys are not injected into lexical scope. This is a maintainability convention, not a security control.

Callers cannot change delimiters, escape function, context, cache, filename, root, views, includer, file loader, or other EJS behavior. Async templates and top-level await are unsupported. Whitespace is preserved.

The Worker actively disables EJS's own loading channel: `includer` always throws and the Worker-local `ejs.fileLoader` is replaced with another throwing function. Relative, absolute, and indirect EJS include attempts fail as generic `RENDER_FAILED`; no attempted path or raw failure leaves the Worker. Canary tests prove that include cannot read a temporary file. This does not block ordinary JavaScript from accessing runtime capabilities and does not form a sandbox.

Detached data remains mutable inside one render. The template may add, change, or delete fields and observe the changes later in that execution. Data is not frozen or proxied, mutations are not returned or written back, and parallel or later renders receive independent copies. One-shot termination discards data mutations and template global state.

Synapse does not replace `Date`, `Math.random`, locale, timezone, `process.env`, or other runtime state and does not inject timestamps, seeds, or a fixed timezone. Identical inputs are byte-reproducible only when the authored template itself is deterministic and depends only on data.

## Strict data normalization and Unicode

Before serialization, the shared entry validates the entire object graph without calling `toJSON`:

- The top level and nested objects must have `Object.prototype` or null prototype.
- Values are limited to null, strings, booleans, finite numbers, arrays, and ordinary objects.
- Dates, maps, sets, typed arrays, class instances, boxed primitives, functions, BigInts, symbols, and undefined are rejected.
- Cycles, sparse arrays, custom array properties, accessors, symbol keys, and non-enumerable business properties are rejected.
- Repeated non-cyclic references are allowed but lose identity after normalization.
- `__proto__`, `constructor`, and `prototype` survive only as JSON string keys and are never merged into options or assigned as prototypes.

Validation occurs before `JSON.stringify`. The first serialization determines data bytes; parsing that text creates a detached pure-JSON copy; serializing `{ template, data: detachedCopy }` determines the full request size. Unsupported values are never silently dropped or converted to null.

Template text must be well-formed Unicode or returns `INVALID_TEMPLATE`. Every data string value and object key must be well-formed or returns `INVALID_DATA`. Worker HTML must be well-formed or returns `RENDER_FAILED`. The generator never calls `toWellFormed` or silently inserts U+FFFD. This rule is local to HTML Generator and does not change Writer behavior for other formats.

## Size limits

All limits use UTF-8 bytes and apply identically to App, MCP, and Workflow:

| Value | Limit | Failure |
| --- | ---: | --- |
| Template | 256 KiB | `TEMPLATE_TOO_LARGE` |
| Strict serialized data | 512 KiB | `DATA_TOO_LARGE` |
| Serialized `{ template, data }` | 768 KiB | `INPUT_TOO_LARGE` |
| Generated HTML | 5 MiB | `OUTPUT_TOO_LARGE` |

The output path is not part of the Worker input budget. The Worker checks output Unicode and `Buffer.byteLength(html, "utf8")` before posting the body; oversized output is rejected without transferring the full HTML. The main process repeats type, Unicode, byte, limit, and Worker-reported-size validation. Mismatch or protocol error is `RENDER_FAILED`. Output is never truncated or streamed.

## Service and Worker architecture

The capability package owns two registered services:

```text
App / MCP / Workflow
        │
        ▼
core.html-generator
  validation → permission/audit → shared FIFO → one-shot Worker
        │
        └──────────────► { html, size }

core.html-generator-file
  core.html-generator → core.text-file-writer
        └──────────────► { output }
```

`core.html-generator` is the unique singleton. It owns normalization, `shell.exec`, render audit, scheduling, Worker creation, cancellation, and `stop()`. Every adapter resolves that singleton from the registry. A closed internal operation enum maps only to the two capability ids for correct auditing.

`core.html-generator-file` is a stateless singleton created by `createHtmlGenerationToFileService`. It depends on `core.html-generator` and `core.text-file-writer`, owns no queue, Worker, permission system, file concurrency, or stop behavior, and releases the render slot after the checked result before calling Writer. Only the core service cancels queued work and terminates Workers during shutdown.

Every render launches a new Worker Thread with `resourceLimits.maxOldGenerationSizeMb = 128`. Workers are never reused and no automatic retry or main-process fallback exists. `ERR_WORKER_OUT_OF_MEMORY`, in the absence of an earlier terminal state, becomes `RENDER_MEMORY_LIMIT`. The limit covers the Worker V8 old-generation heap, not complete process memory or security isolation.

Workers use separate stdout and stderr pipes. The main process immediately drains and discards both streams; console or standard-stream content never enters logs, audit, HTML, or errors. Stream failures produce content-free diagnostics only. This is a log-confidentiality measure, not a general exfiltration boundary.

## Scheduling, timers, and cancellation

String and file generation share one FIFO scheduler:

- `HTML_GENERATION_MAX_CONCURRENCY = 2` running Worker slots.
- `HTML_GENERATION_MAX_QUEUED = 4` waiting render requests.
- Input validation completes before enqueue.
- The fifth waiter is rejected immediately as retryable `RENDER_QUEUE_FULL`.
- App, MCP, and Workflow have no priority or reserved capacity.
- File writing consumes neither a Worker slot nor an HTML queue position.

Worker startup and rendering have separate fixed timers:

- `HTML_GENERATION_WORKER_START_TIMEOUT_MS = 5_000` begins after Worker creation.
- After initialization and both include blockers are installed, the Worker sends one `started` immediately before compile.
- Validated `started` clears the startup watchdog and begins `HTML_GENERATION_TIMEOUT_MS = 5_000` for compile plus execute.
- Queue time counts toward neither timer.
- Startup expiry terminates the Worker and returns `RENDER_FAILED` with “渲染 Worker 启动失败。”.
- Render expiry terminates the Worker and returns `RENDER_TIMEOUT`.
- Callers cannot override either timer.

An abnormal task can occupy one slot for about ten seconds. With two active slots and four accepted waiters, the last accepted request has a legal worst render path near 30 seconds.

Cancellation uses the first accepted terminal state:

- Waiting or Worker cancellation returns `RENDER_CANCELLED` and creates no file.
- Cancellation after render but before Writer also returns `RENDER_CANCELLED`.
- Once Writer owns the operation, its `ABORTED` behavior is preserved.
- Cancellation before atomic commit cleans the temporary file and leaves the target unchanged.
- A completed commit wins over later cancellation and returns success; committed files are never deleted or rolled back.
- Success, cancellation, timeout, OOM, error, or abnormal exit compete through one atomic state transition; later events are ignored.
- `worker.terminate()` failure is logged without content and never changes the selected business result.

App IPC creates one `AbortController` per tab invocation, binds it to `ctx.sender.onDestroyed`, passes the signal through rendering and Writer, and removes the listener on settlement. Closing or reloading cancels cancellable work; switching tabs does not. There is no cancel button, cancel capability, cancel Tool, request id, or cancellation field. Workflow uses the run-context signal. MCP timeout does not claim server cancellation.

## Worker protocol

`workerData` is strict and contains only:

```ts
{ template: string, data: JsonObject }
```

Worker messages are strict:

```ts
{ type: "started" }
{ type: "success", html: string, size: number }
{
  type: "error"
  code: "TEMPLATE_COMPILE_FAILED" | "OUTPUT_TOO_LARGE" | "RENDER_FAILED"
  line?: number
}
```

The Worker receives no path, overwrite, actor, source, capability, permission, option, or timeout. It cannot report timeout, cancellation, OOM, queue, or permission errors. It sends no message text, stack, source, path, or raw exception. The main process strictly validates exactly one `started` followed by exactly one terminal message; duplicate, reordered, unknown, or malformed messages are `RENDER_FAILED`. This protocol improves reliability and is not a defense against malicious same-authority template code.

`TEMPLATE_COMPILE_FAILED` carries no line in the first version. `RENDER_FAILED` may carry a line only when Worker code matches `^ejs:(\d+)\n` at the start of EJS 6.0.1's `rethrow` message, verifies a positive value within EJS's template line count, retains the number, and discards the complete message. It never parses stacks, columns, generated-function locations, or other numbers. EJS upgrades regress this exact behavior and omit line rather than guessing if the format changes.

## Errors

The closed render codes are:

```text
INVALID_TEMPLATE
INVALID_DATA
TEMPLATE_TOO_LARGE
DATA_TOO_LARGE
INPUT_TOO_LARGE
TEMPLATE_COMPILE_FAILED
OUTPUT_TOO_LARGE
PERMISSION_DENIED
RENDER_QUEUE_FULL
RENDER_TIMEOUT
RENDER_MEMORY_LIMIT
RENDER_CANCELLED
RENDER_FAILED
```

The public payload is `{ code, message, retryable, line? }`. Only queue full is retryable. A shared module owns the fixed Chinese messages recorded in ADR 0039. Startup timeout is the sole fixed `RENDER_FAILED` message override. App, MCP, Workflow, and structured logs use the same normalized result. Writer errors keep Writer codes and messages and are never relabelled as render failures. No layer retries rendering automatically.

## Permission and audit

The execution order is:

1. Strict schema, Unicode, JSON normalization, byte limits, and final file-path precheck.
2. Existing `shell.exec` permission for the selected HTML Generator capability.
3. Shared render scheduler and Worker.
4. For file generation, checked result passed to Writer, which performs its own file permission and audit.

`shell.exec` is the existing local code-execution classification; EJS is not run through a system shell. Workflow sharing declares `template` as `shell.execute`. No new `code.execute` or template-digest trust database is introduced. Import uses the existing risk step and states that EJS executes JavaScript. Any future “code changed, reconfirm” mechanism must be uniform across Script, EJS, and other executable configuration.

Pre-authorization input failures create no shell permission audit. Denial records one denied event and creates no Worker. After authorization, queue rejection, cancellation, timeout, OOM, compile failure, runtime failure, or protocol failure records one failed render-capability audit. Successful rendering records allowed. File generation keeps render audit separate from Writer path-resource audit; Writer failure never rewrites render success.

Render audit resource is the capability id. Metadata is limited to source, template/data/request/output byte counts when available, duration, result, and normalized code. It never includes template, data, HTML, output path, raw EJS error, source context, or stack. HTML Generator cannot completely identify or audit external effects initiated directly by executable template code.

## Shared Text File Writer extension

`TEXT_FILE_FORMATS` adds `html` and `htm` globally. Writer App, MCP, Workflow, IPC, and Service accept complete HTML text while retaining existing path safety, directory creation, permission, target queue, concurrent-change check, temporary file, and atomic commit behavior.

Extensions are matched case-insensitively; returned `format` is lowercase and the requested path is not rewritten. `.html` and `.htm` accept only `utf8`. Combining either with `utf16le` uses the existing `INVALID_ENCODING` code and a safe HTML-only-UTF-8 message. Writer UI prevents submission but does not silently change encoding; Service remains authoritative. Existing txt/md/csv UTF-8 and UTF-16LE behavior is unchanged.

HTML Generator always calls Writer with UTF-8 and exposes no encoding. Writer does not inspect, repair, validate, preview, or insert charset metadata. Text Extractor's own to-file schema remains limited to txt/md/csv so the shared extension does not broaden extraction accidentally.

## MCP

The common MCP definition currently exposes name, description, and input schema only. HTML Generator does not add feature-specific annotations or metadata. Any future standard annotations are a horizontal upgrade.

Both Tool descriptions state that trusted EJS JavaScript executes, the Worker is not a security sandbox, and include is disabled. The string Tool says HTML Generator returns complete HTML but does not automatically save, open, or validate it. The file Tool says it writes only an absolute `.html/.htm` path as UTF-8 and uses explicit `overwrite`. Field descriptions explain only their fields. Capability metadata remains the values in the identity table.

## Workflow

Workflow schema changes from `2.4.0` to `2.5.0`. Adding the two node types is a backward-compatible minor extension. Implementation adds a 2.4.0→2.5.0 identity migration, historical fixture, and `workflow-schema/contract.json` update. Old documents change only `meta.schemaVersion`. Share-package format remains V4; `requiredCapabilities` at 1.0.0 blocks older clients. The generic runtime correction that stops pre-processing arbitrary `config.template` does not add another schema bump because existing Text and End semantics remain in their own executors.

The generic Workflow Engine owns `config.prompt` and run-record behavior only. Template semantics belong to each node executor. Existing Text and End executors continue calling `interpolatePrompt`; HTML Generator passes `config.template` verbatim to EJS. Regression tests prove EJS `{{ clientSideValue }}` remains literal while Text/End interpolation still works. The generic engine and validator do not hard-code HTML Generator node types.

Each HTML node has exactly one reserved binding named `data`. It cannot be renamed or shadowed and its source must be a reachable upstream `node_output`. The executor reads the upstream string primary output and strictly parses pure JSON whose top level is an object. Empty output, null, arrays, scalars, Markdown fences, explanations, or invalid JSON return `INVALID_DATA`. The first version does not expand Workflow's typed output system.

String-node config accepts only `template` and the exact data binding. File-node config adds `outputPath`, `overwrite`, and ordinary bindings used only by output-path interpolation. Parsed data is removed from that interpolation scope; `{{data}}` is unbound. Template never uses Workflow interpolation. The final interpolated output path is validated before enqueue.

Newly dropped nodes may temporarily hold incomplete editor drafts:

```ts
{ template: "", variables: [] }
{ template: "", outputPath: "", overwrite: false, variables: [] }
```

Drafts cannot be saved, run, or exported until their strict node-owned config schema passes. Editing, saving, exporting, and import planning never compile EJS, create a Worker, request permission, or write render audit. Panels validate nonempty well-formed template Unicode and the 256 KiB limit, but actual compile and data/request limits occur only at execution. A syntactically invalid template may be persisted.

The string node primary output is full HTML and structured outputs contain only `size`. The file node primary output is the canonical actual path and structured outputs contain complete Writer metadata. During execution, full HTML up to 5 MiB remains available to downstream bindings. Renderer events, run status, and persisted snapshots reuse the existing approximately 10,000-byte history representation with `[truncated]`; no HTML body store is added. Truncation never changes the in-run downstream value.

Share contracts:

- String: not self-contained; requires `app.html_generator.ejs.generate@1.0.0` from `synapse.builtin`; `template` has `shell.execute` risk; no file resource.
- File: not self-contained; requires `app.html_generator.ejs_file.generate@1.0.0`; the same template risk; `outputPath` is one writable file resource.
- Template stays in Workflow body and appears in import risk review.
- Data binding remains an internal graph reference handled by central graph/id rewriting.
- Neither node declares runtime shell packages, models, projects, environments, or extra portability warnings.

Capability-owned panels use the existing Textarea, a dedicated reachable-upstream data selector, and the concise trusted-code warning. The file panel adds output file, overwrite, and a separate ordinary path-variable list. Cards never show template source, snippets, HTML, result, or repeated risk text. Titles are “生成 HTML” and “生成 HTML 文件”; summaries are the data source or “未选择数据”, and output path or “未设置输出文件”.

## System App

The App uses one independent window with `SystemAppTopBar` centered tabs “生成 HTML” and “生成文件”. Tabs call their corresponding capabilities directly. They share template and JSON data draft state; the file tab adds outputPath and overwrite. There is no validation, preview, or open tab.

Its registry definition uses `name` and `windowTitle` “HTML 生成器”, namespace `html_generator`, primary MCP prefix `app_html_generator`, `window.openable: true`, dock order 243, and `pinnedByDefault: false`. It is launcher-visible, non-removable, non-renameable, and icon editing is disabled. Registering its capabilities never opens it automatically. The package owns a distinct RGBA PNG icon showing an HTML document with angle brackets and no text, gradient, glow, or decoration; it does not reuse another system App icon. Registry tests lock name, order, pin state, prefix, and icon identity.

The App keeps the common system-window bounds of 1180×760 with a 960×640 minimum and does not add per-App window metadata. Its content scrolls as one centered, single-layer work surface without nested cards. Template and data use equal-width, equal-initial-height Textareas with labels above; they form two columns at the `lg` breakpoint and stack below it, and each remains vertically resizable. File path and overwrite follow the editors on the file tab. The active tab's action and inline status share one bottom action area. String results use a full-width read-only source area below the editors; file results use compact metadata without another Card. The top bar contains only centered tabs and permitted ghost actions. There is no sidebar, draggable split, collapsible panel, or fullscreen editor.

Initial state is template `""`, data text `"{}"`, outputPath `""`, overwrite false, no status, and the string tab active. Template receives focus. Drafts exist only for the window lifetime; close or reload restores the initial state.

Template, JSON data, and read-only HTML use existing shadcn Textarea controls with monospaced text, `spellCheck={false}`, preserved whitespace, vertical resize, and content scrolling. The Renderer parses data for immediate top-level-object feedback; the main process remains authoritative. The concise field warning is “EJS 模板会执行 JavaScript，仅使用可信内容”.

The App displays UTF-8 counters below template and valid parsed/reserialized data: current/256 KiB and current/512 KiB. Invalid JSON shows only its parse error. Single-field excess appears beside the field; combined 768 KiB excess appears beside actions. Either disables both submissions. It uses no percentage, progress bar, warning scale, or predicted output size.

The file path is editable and has a system save chooser filtered to html/htm. The current nonempty path is `defaultPath`, otherwise `output.html`. Cancel leaves state unchanged. The App accepts the returned path verbatim and never infers overwrite, appends an extension, changes case, or rewrites a directory. Renderer validation is immediate and main-process validation is authoritative.

String results display full read-only source, copy HTML, and actual UTF-8 bytes without DOM insertion, truncation, repair, save, or preview. File results display actual absolute path, format, bytes, and overwritten state with copy-path only. No result opens or reveals a file.

Each tab permits one active request and the two tabs may submit the same frozen template/data revision concurrently. While either runs, shared editors are read-only; file controls lock only for the file request. Tab switching remains available. Each submission records revision and request identity in Renderer state so only a still-current response updates its tab. Input edits invalidate results and errors under the confirmed shared/file rules. There is no cancel button; closing/reloading relies on sender destruction.

Run failures use one existing `Alert` per tab and show normalized message plus “第 N 行” when present. They never show code, column, raw error, context, generated function, or stack. Field errors remain local and are not duplicated in the Alert. The App does not modify or navigate template source after failure.

First-version copy is fixed and minimal. Field labels are “EJS 模板”, “JSON 数据”, “输出文件”, and “覆盖已存在文件”; the trusted-code warning is exactly “EJS 模板会执行 JavaScript，仅使用可信内容”. String-generation actions are “生成 HTML” and “生成中”; file actions are “生成 HTML 文件” and “生成并写入中”. Copy actions are “复制 HTML” and “复制路径” and use the existing “已复制” toast on success. The chooser action is “选择”. The source-result heading is “HTML 源码”. File metadata labels are “路径”, “格式”, “字节数”, and “已覆盖”, with “是/否” values. The App adds no readiness summary, capability explanation, or prefixed “操作失败：” text. Initially disabled actions receive no extra explanation; concrete field feedback appears only after its validation has been triggered.

## HTML content and opening boundary

Literal template HTML and raw EJS output may contain scripts or other active content. HTML Generator treats them as text. It does not load a DOM, execute scripts, request resources, sanitize, preview, or automatically open. Success states only that rendering completed and, for the file entry, Writer committed the bytes. It promises no safety, trust, accessibility, standards compliance, or browser execution behavior.

Opening is always a separate explicit call to `app.file_opener.file.open` or `file_opener_file_open`, with that capability's own permission and audit. No HTML Generator App, MCP Tool, or Workflow node opens output implicitly.

## Packaging and platform support

`worker.ts` and `worker-launch.ts` live in `desktop/app-capabilities/html-generator/main/`. `tsconfig.electron.json` includes them and the existing TypeScript build emits Worker JS and sourcemap. No new esbuild chain or `extraResources` copy is added.

`asarUnpack` covers `dist-electron/app-capabilities/html-generator/**` and `node_modules/ejs/**`. Production resolution maps the packed path to `app.asar.unpacked`; development and tests use the existing strategy and injectable Worker factory. `check:packaged-asar` verifies service, launcher, Worker JS/map, EJS package, license, and actual CJS runtime entry. A formal package smoke launches the real Worker and renders through EJS.

Formal support is macOS arm64 and Windows x64. Both run shared tests and packaged smoke. Native absolute-path semantics apply: POSIX rejects Windows drive paths, Windows rejects `/tmp`, Windows tests drive/backslash/UNC/device safety, and macOS tests symlink and actual filesystem case behavior. Extension matching is case-insensitive with lowercase result format and unchanged path. Linux remains best-effort source portability without first-version release commitment.

## Verification

Verification is layered:

- Shared schema/normalization/Unicode/exact-size unit tests.
- Real EJS Worker semantics and state-isolation integration tests.
- Include and stdout/stderr canary tests.
- At least one real infinite-loop template proving approximately five-second termination.
- Fake Worker/fake timer scheduler, startup, render, cancellation, shutdown, protocol, and terminal-race matrices.
- Injected OOM error; CI never intentionally exhausts machine memory.
- Permission, audit, and no-content-log tests.
- Real temporary-directory Writer and atomic cancellation tests.
- Workflow engine, history, schema migration, share, panel, card, and interpolation regressions.
- App initial state, validation, locking, stale response, chooser, copy, and independent-result tests.
- MCP schema, mapping, metadata, descriptions, 60-second routing, and queue-budget tests.
- macOS and Windows packaged-asar validation plus real Worker smoke.

The approximately 30-second scheduler test is specifically the legal worst render budget under concurrency two, queue four, and separate five-second startup/render phases. MCP routing asserts the revised 60-second value.

## Documentation and release synchronization

During design, this specification, `2026-07-22-text-file-writer-design.md`, `CONTEXT.md`, and ADRs 0036–0040 are authoritative. Implementation completion must update:

- Synapse Skill App index and API reference for both Tools.
- Synapse Skill Workflow index and API reference for both nodes.
- Text File Writer App/Workflow guidance for html/htm and HTML-only UTF-8.
- Capability naming matrix.
- `AGENTS.md` with only stable long-term EJS, Worker, Writer-composition, and Workflow-template boundaries.
- `RELEASE_NOTES_PENDING.md` with user-visible behavior.

Do not add legacy resource-template Skills, website marketing copy, or a standalone EJS tutorial in the first version. Skill guides, repository rules, and release notes land with working code rather than claiming availability during design.

## Version decisions

| Version line | Decision | Reason |
| --- | --- | --- |
| Workflow document | `2.4.0` → `2.5.0` | Two backward-compatible node types and config schemas are added. |
| Workflow share package | Keep V4 | Container and manifest semantics do not change. |
| String capability | `1.0.0` | New public runtime capability. |
| File capability | `1.0.0` | New public composed runtime capability. |
| Text File Writer capability | `1.0.0` → `1.1.0` | HTML/HTM and the HTML-only-UTF-8 contract are a backward-compatible capability expansion that old clients must not claim to support. |

New Text File Writer Workflow exports uniformly require `app.text_file_writer.file.write@1.1.0`, including txt/md/csv configurations. The share contract does not infer or downgrade a capability version from a possibly dynamic path. Old packages requiring 1.0.0 remain importable by a 1.1.0 client, while new packages correctly block older clients. HTML Generator nodes require only their respective 1.0.0 capability; the built-in Writer used by file generation is an internal implementation dependency rather than a second share requirement.
