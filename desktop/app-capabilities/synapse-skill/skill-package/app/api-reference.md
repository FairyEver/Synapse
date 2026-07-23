# Synapse App MCP API Reference

## `app_text_file_writer_file_write`

Write one complete text value to a local text file.

Input:

- `text` required: complete string. Empty text is valid. The schema has no `maxLength` and the tool does not require chunking.
- `path` required: current-OS absolute local path ending in `.txt`, `.md`, `.csv`, `.html`, or `.htm`, matched case-insensitively on the final extension.
- `encoding` optional: exactly `utf8` or `utf16le`; defaults to `utf8`. `.html` and `.htm` accept only `utf8`.
- `overwrite` optional: explicit permission to replace an unchanged existing regular file; defaults to `false`.

The tool creates missing parent directories. It does not expand `~`, environment variables, shell expressions, or `file://`; add a BOM; trim or normalize text; append a newline; or parse Markdown/CSV. The result is `{ path, fileName, format, encoding, size, overwritten }`, where `path` is the canonical actual target and `size` is the written byte count.

Stable failures are `{ code, message, retryable }`. Codes are `INVALID_PATH`, `UNSUPPORTED_EXTENSION`, `INVALID_ENCODING`, `TARGET_EXISTS`, `UNSAFE_TARGET`, `TARGET_CHANGED`, `PERMISSION_DENIED`, `ABORTED`, and `WRITE_FAILED`; only `TARGET_CHANGED` is retryable. Failures do not commit a partial target file, although newly created parent directories can remain.

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

Extraction and writing happen inside Synapse. The extracted `text` is passed directly to the shared text-file writer and is not included in the MCP response. The tool uses the same extraction limits, read permission, write permission, path safety, and atomic commit behavior as the two dedicated tools. Extraction failures use the extraction error codes above. Write failures use `INVALID_PATH`, `UNSUPPORTED_EXTENSION`, `INVALID_ENCODING`, `TARGET_EXISTS`, `UNSAFE_TARGET`, `TARGET_CHANGED`, `PERMISSION_DENIED`, `ABORTED`, or `WRITE_FAILED`; only `TARGET_CHANGED` is retryable.

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
