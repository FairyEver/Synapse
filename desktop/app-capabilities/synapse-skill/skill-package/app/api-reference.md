# Synapse App MCP API Reference

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` first with the user's intent or the exact `app_*` name, then call `invoke` with the exact name and the `arguments` described by the `inputSchema` that `search` returned. Never guess a name or arguments. In Synapse Agent conversations the same two tools appear as `mcp__synapse-tool-router__search` and `mcp__synapse-tool-router__invoke`.

## Desktop update and restart tools

All four tools take an empty object. `app_update_state_get` returns the existing updater fields (`currentVersion`, `releaseVersion`, `status`, `message`, `error`, download progress, `lastCheckedAt`, `canCheck`, `installRecovery`) plus `bootId`, `startedAt`, and `remoteOperation: { id, kind, phase, error } | null`. `bootId` changes on a full process restart. `remoteOperation` is process-local; it cannot prove success after that process exits.

- `app_update_check` performs a fresh check when safe and returns the same state shape. If a check, download, installed download, or recovery flow is already active, it returns the current state without discarding that work. `unsupported` means this is not a packaged macOS or Windows build.
- `app_update_run` returns `{ accepted: true, operationId, phase }` after the desktop main process accepts the request. It checks, downloads, and installs in the background; no available update ends the operation without restarting. A repeated call during the same update returns the same ID. A concurrent restart conflicts. Check `remoteOperation` for failure while still connected, or compare version and boot ID after reconnecting.
- `app_desktop_restart` returns `{ accepted: true, operationId, phase }` before a full quit and relaunch. A repeated call during the same restart returns the same ID. A concurrent update conflicts. Unsynced repository changes are retained for later push without a local desktop dialog.

Installation still uses the desktop updater's native handoff and recovery checks. A failed macOS handoff leaves the running process in place and exposes the failure in `remoteOperation.error`; it must not be reported as a successful restart.

## `app_account_state_get`

Read the signed-in account state of the desktop application.

- Input: none.
- Output: `{ status, ... }`, one of:
  - `{ status: "unauthenticated" }` — nobody is signed in.
  - `{ status: "authenticating", loginUrl? }` — a sign-in is in flight.
  - `{ status: "authenticated", connectivity: "online" | "offline", profile, offlineReason?, retry? }` — `profile` carries `user.{id,email,handle,status}` and `syncedAt`. `connectivity: "offline"` means the session is intact but the server is currently unreachable; `retry.nextRetryAt` is when the client will try again on its own.
  - `{ status: "error", message, profile? }` — the last account operation failed.

## `app_account_login_start`

Start a desktop account sign-in, or resume the one already in flight. Equivalent to pressing the sign-in button: it opens the login page in the default browser.

- Input: none.
- Output: `{ state, loginUrl?, outcome }`. `state` is the account state as described above. `loginUrl` is the page that was opened, and is absent only when `outcome` is `already_authenticated`. `outcome` is one of:
  - `opened` — a new attempt was persisted and the browser opened on it.
  - `reused_attempt` — a login was already in flight; the same URL was reopened and that attempt was left untouched.
  - `already_authenticated` — the account is signed in and online. Nothing was changed.
  - `open_failed` — the attempt is live but the browser could not be opened. `loginUrl` is still returned, so it can be handed to the user or opened manually.
  - `start_failed` — no attempt was established. Reported as an error with code `login_unavailable`; there is nothing to poll.
- **The sign-in completes asynchronously.** This tool returns as soon as the page is opened; it does not wait for the sign-in. Poll `app_account_state_get` until `status` is `authenticated` before reporting success.
- The call is idempotent. An account that is signed in **and online** is left untouched, and a login already in flight is resumed rather than restarted, so repeating the call cannot invalidate the page the user already has open. An account that is signed in but **offline** is deliberately not covered by that guard, because re-login is a remedy for that state.

## `app_agent_provider_list`

- Input: `{ providerId?, query?, offset?, limit? }`. Exact provider ID filter; query searches provider/model names case-insensitively. Offset defaults to 0; limit defaults to 50, maximum 100.
- Output: `{ providers: [{ providerId, name, models: [{ modelTier, modelName, displayName }] }], nextOffset }`. Only non-archived providers and selectable configured tiers are returned; a matching provider includes all selectable tiers. An unknown/archived provider returns an empty list. Local Claude Code default may have `modelName: null`. No credentials, environment, paths or connection settings are exposed.
- Use the returned providerId/modelTier pair for custom creation. Follow nextOffset until null. Clarify ambiguous names rather than choosing arbitrarily.

## `app_agent_group_list`

- Input: `{ query?, offset?, limit? }`. `query` is a non-empty name substring (up to 256 characters), `offset` defaults to 0, and `limit` defaults to 50 and is at most 100.
- Output: `{ groups: [{ projectId, name, isDefault }], nextOffset }`. `nextOffset: null` means the last page. Results include 本地对话 and configured projects; no paths, model credentials, history, or archived section are returned.

## `app_agent_conversation_create`

- Input: `{ projectId?, projectName?, sameGroupAs?, name?, providerId?, modelTier?, idempotencyKey }`. The key is a UUID. Name and exact project name are non-empty trimmed strings up to 256 characters. Unknown fields and multiple group selectors are rejected.
- No selector defaults to 本地对话. `projectName` must match exactly one group. `sameGroupAs` accepts the same target forms as `open` below, including the complete unchanged `deepLink`; it only selects the source conversation's project.
- Output: `{ created: true, projectId, providerId, modelTier, conversationRef, deepLink }`. Use these identifiers with `app_agent_message_send`, `app_agent_conversation_inspect`, or `app_agent_conversation_open`. Creation does not send a message or open the UI.
- `providerId` and `modelTier` must be supplied together. Tier is `default | opus | sonnet | haiku`; discover valid pairs through `app_agent_provider_list`. Explicit missing, archived or unselectable choices fail with `model_unavailable` without fallback. When both are omitted, uses the current UI quick-create default model selection, configured default permission mode, ordinary agent identity, and local conversation source. Missing groups never fall back to 本地对话. The original conversation's content/configuration is not copied.
- Duplicate unchanged requests from one client reuse the created result within the process-local bounded 10-minute cache. Changed input with the same key returns `idempotency_conflict`; restart or eviction ends deduplication.
- Additional stable errors: `group_not_found`, `group_ambiguous`, `model_unavailable`, `project_unavailable`. Existing validation, permission, rate-limit, and operation errors also apply.

## `app_agent_conversation_open`

Open and focus an existing conversation in the local Synapse Agent interface.

Target input uses exactly one form:

- `{ deepLink }` for a complete user-supplied Agent link. Pass it unchanged; Synapse parses it.
- `{ projectId, conversationRef }` for follow-up calls after a successful inspection.
- Legacy `{ projectId, conversationId }` remains compatible.

Mixing forms and unknown fields are rejected. Markdown escapes before `.`, `_`, and `-` inside the thread identifier are normalized by Synapse before strict format and checksum validation. Pass the original complete link unchanged. Generated links percent-encode these punctuation characters; plain links remain accepted.

Output is exactly `{ opened: true }`. No title, session key, message, transcript, or other conversation content is returned. Agent conversation links use only `synapse://threads/<thread-id>`, with one short checksummed path identifier and no project query. Synapse resolves that identifier across local persisted projects; the former `synapse://app/agent/open` route is rejected.

Stable failures are `invalid_input`, `invalid_link`, `invalid_locator`, `not_found`, and `open_failed`. `not_found` means the conversation was deleted or cannot be uniquely resolved in the receiving local Synapse data. This capability only navigates that Synapse installation and does not share or synchronize a conversation across devices.

## `app_agent_conversation_inspect`

- Input: one target form above plus `{ beforeIndex?, limit? }`; `limit` defaults to 50 and is at most 100. Use `{ deepLink, limit }` for the first read.
- Returns source, `controllable`, a short stable `conversationRef`, revision, runtime state, pending requests, and one bounded visible timeline page. Use `{ projectId, conversationRef, beforeIndex }` to page backward.
- Each item is at most 64 KiB and each page at most 1 MiB. Secrets, provider/SDK session identifiers, raw SDK payloads, Base64, and internal artifact URLs are removed or redacted.

## `app_agent_conversation_observe`

- Input: one target form above plus `{ afterRevision, maxWaitMs }`; prefer `projectId` and `conversationRef` returned by inspect. The wait is at most 30 seconds.
- Returns `changed`, `revision`, `changeTypes`, `historyCount`, and runtime state without timeline bodies.
- Lifecycle is `idle | queued | starting | running | awaiting_permission | stopping`; state includes the active `turnId` and bounded queued turns.

## `app_agent_message_send`

- Input: one target form above plus `{ content, idempotencyKey }`; content is non-empty and at most 64 KiB, and the key is a UUID.
- Returns `{ accepted, turnId, disposition, queuePosition, revision }` immediately after admission, without waiting for completion.
- Only `controllable: true` local user conversations accept control.

## `app_agent_turn_steer`

- Input: one target form above plus `{ expectedTurnId, clientMessageId, content }`; `clientMessageId` is a UUID.
- Applies only to the exact active turn. Slash commands, changed turns, permission waits, cancellation, ended sessions, and unsupported sessions are rejected.

## `app_agent_turn_stop`

- Input: one target form above plus `{ expectedTurnId, idempotencyKey }`.
- Requests graceful stop for the exact active turn and never automatically force-stops it.

## `app_agent_turn_force_stop`

- Input is the same as stop.
- Force-terminates only the exact active turn and requires an explicit current user request to force stop.

## `app_agent_permission_respond`

- Common input: one target form above plus `{ expectedTurnId, requestId, idempotencyKey, kind, decision }`.
- Tool permission: `kind: "tool_permission"`, exact `expectedToolName`, and `decision: "allow_once" | "allow_session" | "deny"`.
- User question: `kind: "user_question"`, and either `decision: "skip"` or `decision: "answer"` with every answer as `{ questionIndex, values }`.
- Project, conversation, active turn, pending request, kind, tool name, answer completeness, and option cardinality are checked.

Control tools use stable errors including `invalid_input`, `invalid_link`, `invalid_locator`, `not_found`, `project_unavailable`, `control_not_supported`, `no_active_turn`, `turn_changed`, `permission_not_pending`, `permission_kind_mismatch`, `idempotency_conflict`, `watermark_ahead`, `quota_exceeded`, and `operation_failed`.

## `app_text_file_writer_file_write`

Write one complete text value to a local text file.

Input:

- `text` required: complete string. Empty text is valid. The schema has no `maxLength` and the tool does not require chunking.
- `path` required: current-OS absolute local path. Any extension or no extension is accepted.
- `encoding` optional: exactly `utf8` or `utf16le`; defaults to `utf8` for every target.
- `overwrite` optional: explicit permission to replace an unchanged existing regular file; defaults to `false`.

The tool creates missing parent directories. It does not expand `~`, environment variables, shell expressions, or `file://`; add a BOM; trim or normalize text; append a newline; or parse the content according to the path. The result is `{ path, fileName, format, encoding, size, overwritten }`, where `path` is the canonical actual target, `format` is the lower-case final extension or `""` when none exists, and `size` is the written byte count.

Stable failures are `{ code, message, retryable }`. Codes are `INVALID_PATH`, `INVALID_ENCODING`, `TARGET_EXISTS`, `UNSAFE_TARGET`, `TARGET_CHANGED`, `PERMISSION_DENIED`, `ABORTED`, and `WRITE_FAILED`; only `TARGET_CHANGED` is retryable. The Writer never returns `UNSUPPORTED_EXTENSION`. Failures do not commit a partial target file, although newly created parent directories can remain.

## `app_html_generator_ejs_generate`

Render a trusted EJS template string with structured JSON data and return the complete result without automatically saving, opening, previewing, or validating it. Template JavaScript runs in a one-shot Worker under the application's permission domain; the Worker timeout and termination controls are reliability boundaries, not a security sandbox. EJS include and template file loading are disabled.

Input:

- `template` required: non-empty EJS template string, at most 256 KiB as UTF-8 and containing no isolated UTF-16 surrogate.
- `data` required: JSON-compatible top-level object. Its normalized JSON form is at most 512 KiB; templates access it through the explicit `data` root.

The serialized `{ template, data }` request is limited to 768 KiB. Output may be empty, whitespace, an HTML fragment, or a full document and is limited to 5 MiB. The result is `{ html, size }`, where `size` is the UTF-8 byte count.

Stable render failures are `{ code, message, retryable, line? }`. Codes are `INVALID_TEMPLATE`, `INVALID_DATA`, `TEMPLATE_TOO_LARGE`, `DATA_TOO_LARGE`, `INPUT_TOO_LARGE`, `TEMPLATE_COMPILE_FAILED`, `OUTPUT_TOO_LARGE`, `PERMISSION_DENIED`, `RENDER_QUEUE_FULL`, `RENDER_TIMEOUT`, `RENDER_MEMORY_LIMIT`, `RENDER_CANCELLED`, and `RENDER_FAILED`; only `RENDER_QUEUE_FULL` is retryable.

## `app_html_generator_ejs_file_generate`

Render through the same EJS core and atomically write the checked result through the shared Text File Writer.

Input:

- `template` and `data`: same contract and limits as `app_html_generator_ejs_generate`.
- `outputPath` required: current-OS absolute local path ending in `.html` or `.htm`.
- `overwrite` optional: explicit permission to replace an unchanged existing regular file; defaults to `false`.

The result is `{ output: { path, fileName, format, encoding, size, overwritten } }`. `format` is `html` or `htm`, `encoding` is always `utf8`, and `size` is the rendered UTF-8 byte count. Render failures use the protocol above; write failures preserve the Text File Writer error protocol.

## `app_json_repair_text_repair`

Repair one input string into one complete, validated JSON text result.

Input:

- `text` required: non-blank, well-formed UTF-16 string. Multiline and control content are preserved. Unknown fields are rejected.
- The JSON Schema `maxLength: 131072` is a coarse preflight hint. The authoritative limit is 128 KiB after UTF-8 encoding.

Output:

- `{ json: string }`, where `json` is the exact repaired text that passed final `JSON.parse`, finite-number validation, a 1 MiB UTF-8 output limit, and a maximum nesting depth of 128.

The best-effort pipeline handles complete JSON root values, common malformed JSON, fenced JSON, LLM wrappers, JSONP/MongoDB forms, and whole-input NDJSON using `repair-json-stream` 1.3.1. When ordinary prose contains JSON, only object or array candidates are considered, in source order, until the first candidate succeeds. Heuristic repair can change meaning. The result remains untrusted and is not sanitized, business-validated, or checked against a Schema. Legal keys such as `__proto__`, `constructor`, and `prototype` are preserved.

Stable error codes are `INVALID_INPUT`, `INPUT_TOO_LARGE`, `OUTPUT_TOO_LARGE`, `MAX_DEPTH_EXCEEDED`, `NO_JSON_FOUND`, `JSON_REPAIR_FAILED`, `NON_FINITE_NUMBER`, `CANCELLED`, and `INTERNAL_ERROR`. All errors are non-retryable and contain no input, candidate, parse position, or upstream exception text. Only `INVALID_INPUT` includes restricted `data.field` and `data.reason`.

## `app_file_opener_file_open`

Submit one local file to the operating system's default application.

Input:

- `path` required: one existing absolute local regular-file path. URLs, directories, symbolic links, multiple files, and application selection are rejected.

Output:

- `path`: the submitted absolute path.

Success means `shell.openPath()` returned an empty string, so the operating system accepted the request. Stable errors are `invalid_path`, `file_not_found_or_inaccessible`, `symbolic_link_not_supported`, `not_regular_file`, `permission_denied`, `system_rejected`, and `open_failed`.

## `app_text_extractor_document_extract`

Extract normalized plain text from one local PDF or DOCX. PDF extraction reads the existing text layer. DOCX extraction reads the main document's paragraphs, list text, table cells, and recognizable text boxes. The tool does not perform OCR or layout reconstruction, and does not promise DOCX header, footer, comment, footnote, endnote, or image text.

Input:

- `filePath` required: absolute local `.pdf` or `.docx` path. The extension is case-insensitive and must match the document content. Symbolic links and non-regular files are rejected.

Output:

- `text`: complete normalized plain text. PDF pages are joined in order with two newlines. A supported document without extractable text returns an empty string.
- `format`: `pdf` or `docx`.
- `fileName`: source file name without its full path.
- `size`: source file size in bytes.
- `pages`: PDF page count. Omitted for DOCX.

Limits:

- Source file: 50 MiB.
- Normalized UTF-8 text: 5 MiB.
- PDF pages: 2,000.
- Extraction time: 60 seconds.
- Worker V8 heap: 512 MiB.
- Global concurrency: 2 tasks; additional requests wait in FIFO order.

Stable errors include `UNSUPPORTED_FORMAT`, `INVALID_DOCUMENT`, `PASSWORD_PROTECTED`, `FILE_TOO_LARGE`, `TEXT_TOO_LARGE`, `PDF_PAGE_LIMIT_EXCEEDED`, `READ_FAILED`, `PERMISSION_DENIED`, `EXTRACTION_TIMEOUT`, `EXTRACTION_MEMORY_LIMIT`, `EXTRACTION_CANCELLED`, and `EXTRACTION_FAILED`. Limits fail explicitly and never return truncated text.

## `app_text_extractor_document_extract_to_file`

Extract normalized plain text from one local PDF or DOCX and write it directly to a local text file without returning the document body through MCP.

Input:

- `filePath` required: absolute local `.pdf` or `.docx` source path.
- `outputPath` required: absolute local destination ending in `.txt`, `.md`, or `.csv`.
- `encoding` optional: `utf8` or `utf16le`; defaults to `utf8`.
- `overwrite` optional: explicit permission to replace an unchanged existing regular file; defaults to `false`.

Output:

- `source`: `{ format, fileName, size, pages? }`; `pages` is PDF-only.
- `output`: `{ path, fileName, format, encoding, size, overwritten }`.

Extraction and writing happen inside Synapse. The extracted `text` is passed directly to the shared text-file writer and is not included in the MCP response. The tool uses the same extraction limits, read permission, write permission, path safety, and atomic commit behavior as the two dedicated tools. Extraction failures use the extraction error codes above. Write failures use `INVALID_PATH`, `INVALID_ENCODING`, `TARGET_EXISTS`, `UNSAFE_TARGET`, `TARGET_CHANGED`, `PERMISSION_DENIED`, `ABORTED`, or `WRITE_FAILED`; only `TARGET_CHANGED` is retryable.

## `app_document_template_docx_generate`

Generate a local `.docx` file from a local `.docx` template and JSON object data.

Input:

- `templatePath` required: absolute local `.docx` template path.
- `outputPath` required: absolute local `.docx` output path.
- `dataPath` optional: absolute local `.json` file path. Mutually exclusive with `data`.
- `data` optional: inline JSON object. Mutually exclusive with `dataPath`.
- `overwrite` optional: when `true`, replace an existing regular output file. Defaults to `false`. Symbolic-link output paths are always rejected.

Output:

- `outputPath`: generated file path.
- `fileName`: generated file name.
- `size`: generated file size in bytes.
- `generatedAt`: ISO timestamp.

## `app_sound_notifier_sound_play`

Play a short Sound Notifier reminder on the local computer.

Input:

- `eventType` optional: one of `message`, `input-required`, `success`, `long-running-complete`, or `error`. Defaults to `message`.
- `presetId` optional: legacy preset id, one of `soft-chime`, `done`, `attention`, `error`, or `long-done`. Prefer `eventType`.
- `repeatCount` optional: integer from `1` to `10`. Defaults to `1`.
- `intervalMs` optional: integer from `100` to `60000`. Defaults to `1000`. It is the start-to-start interval between repeated plays.

Do not pass both `eventType` and `presetId`.

Output:

- `played`: whether a sound was queued for playback.
- `eventType`: reminder type selected for this request.
- `presetId`: preset that was selected for this request.
- `repeatCount`: repeat count used for this request.
- `intervalMs`: interval used for this request.

## `app_system_notifier_notification_trigger`

Notify the user with fire-and-forget semantics. The call writes one message into the user's account; Synapse then delivers it to every signed-in desktop of that account and pushes it to the user's registered phones. It travels on the desktop login, so no API key or open API call is needed.

Input:

- `title` required: non-empty single-line string, exactly equal to its trimmed value, at most 64 Unicode code points.
- `body` required: non-empty single-line string, exactly equal to its trimmed value, at most 256 Unicode code points.

Both fields reject CR, LF, Tab, NUL, other Unicode control characters, Unicode line and paragraph separators, and unpaired UTF-16 surrogates. Valid Unicode is preserved without NFC/NFKC normalization or automatic truncation. No other input fields are accepted.

Output:

- `{ success: true }`

The fixed success result means only that a valid call crossed the System Notifier acceptance point. The message is not created when the user turned sending off, when the desktop is signed out or offline, when the process-local rate limit is reached, or when the request failed. Those cases return the same fixed success and produce nothing anywhere; Synapse records which one happened in its own local diagnostics (`notification_sync` with a fixed reason), and the caller cannot see it. Nothing that was not sent is backfilled later. The caller's own path never shows a local notification: each machine shows the message when the delivery reaches it, subject to its own local settings, which can suppress it entirely (notifications off, settings unreadable, Electron notifications unsupported, system permission off, or construction or `show()` failed synchronously). Success never proves delivery or display.

Invalid input returns `INVALID_INPUT` with only `data.field` (`request`, `title`, or `body`) and `data.reason` (`required`, `type`, `leading_or_trailing_whitespace`, `forbidden_character`, `invalid_unicode`, `too_long`, or `unknown_field`). The error never returns the rejected value, a snippet, or its actual length.

## `app_problem_feedback_report_submit`

Submit exactly one user-confirmed plain-text problem report to the Synapse deployment built into the current desktop version. This tool is high risk because it persists user text remotely. It is available only through direct App MCP and never as a Workflow node, Deep Link, Renderer IPC, CLI, browser form, or HTTP fallback.

Input:

- `content` required: the exact complete string shown to and confirmed by the user. No other fields are accepted.
- The schema `minLength: 1` and `maxLength: 262144` are only coarse client hints. The shared runtime validator is authoritative.
- The true maximum is 256 KiB after UTF-8 encoding. Synapse does not impose a separate word or line limit and never truncates or splits an oversized report.
- Content must be non-empty and equal to its trimmed value. LF is allowed and preserved. CR, Tab, NUL, other control characters, Unicode line or paragraph separators, bidirectional text controls, and unpaired UTF-16 surrogates are rejected. No Unicode normalization is performed.
- Markdown, HTML, and URL syntax are stored only as text. Content must not contain prohibited secrets, raw local paths, identity data, raw user materials, unsafe URLs, or correlation identifiers. Passing deterministic validation does not prove that all privacy risks were found.

The caller must show the complete final content and obtain a new unambiguous confirmation in the immediately following user message. One confirmation authorizes exactly one invocation. Never retry automatically.

Success exposes only:

- `{ success: true }`

Failure is marked `isError: true` and normalized to `{ ok: false, code, error, data? }`:

- `INVALID_INPUT`: `data` contains only `field` (`request` or `content`) and the stable `reason`.
- `PRIVACY_RISK`: `data` contains only `category`: `authentication_secret`, `local_path`, `identity`, `user_content`, `unsafe_url`, or `correlation_identifier`.
- `RATE_LIMITED`: no `data`; do not infer or announce a retry time.
- `SUBMISSION_FAILED`: no `data`; Synapse can determine the report was not submitted.
- `SUBMISSION_OUTCOME_UNKNOWN`: no `data`; the report may have been submitted. Explain duplicate risk and do not retry without a new displayed draft and confirmation.

Failures never expose the content, a snippet, length, HTTP status, service address, request identifier, retryability flag, wait time, or internal exception.

### Automatic context maintenance

Long-running Agent turns may compact or rotate their internal SDK session automatically. Continue observing the same conversation and turn; do not resend the task or replay tools to compensate for maintenance. Private checkpoints are not exposed through this API. Permission requests and actual terminal errors retain their existing handling.
