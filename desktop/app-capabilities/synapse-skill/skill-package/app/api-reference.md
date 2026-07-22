# Synapse App MCP API Reference

## `app_text_file_writer_file_write`

Write one complete text value to a local text file.

Input:

- `text` required: complete string. Empty text is valid. The schema has no `maxLength` and the tool does not require chunking.
- `path` required: current-OS absolute local path ending in `.txt`, `.md`, or `.csv`, matched case-insensitively on the final extension.
- `encoding` optional: exactly `utf8` or `utf16le`; defaults to `utf8`.
- `overwrite` optional: explicit permission to replace an unchanged existing regular file; defaults to `false`.

The tool creates missing parent directories. It does not expand `~`, environment variables, shell expressions, or `file://`; add a BOM; trim or normalize text; append a newline; or parse Markdown/CSV. The result is `{ path, fileName, format, encoding, size, overwritten }`, where `path` is the canonical actual target and `size` is the written byte count.

Stable failures are `{ code, message, retryable }`. Codes are `INVALID_PATH`, `UNSUPPORTED_EXTENSION`, `INVALID_ENCODING`, `TARGET_EXISTS`, `UNSAFE_TARGET`, `TARGET_CHANGED`, `PERMISSION_DENIED`, `ABORTED`, and `WRITE_FAILED`; only `TARGET_CHANGED` is retryable. Failures do not commit a partial target file, although newly created parent directories can remain.

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

## Terminal

`app_terminal_group_create`

Create a terminal group after terminal permission approval.

Input:

- `name` required: group name.

Output:

- Terminal group.

`app_terminal_group_list`

List terminal groups and their saved command settings. This read requires terminal permission approval.

Input: none.

Output:

- Terminal groups, including `settings.commands` command names and command text when configured.

`app_terminal_group_rename`

Rename a terminal group after terminal permission approval.

Input:

- `groupId` required: terminal group id.
- `name` required: new group name. Leading and trailing whitespace is trimmed.

Output:

- Terminal group.

`app_terminal_group_update_settings`

Update a terminal group's name and default working directory.

Input:

- `groupId` required: terminal group id.
- `name` required: group name. Leading and trailing whitespace is trimmed.
- `settings.defaultCwd` optional: existing absolute working directory for future sessions in this group.

Output:

- Terminal group.

`app_terminal_group_command_create`

Create a named command under a terminal group.

Input:

- `groupId` required: terminal group id.
- `name` required: command display name.
- `command` required: multi-line command text.

Output:

- Terminal group command.

`app_terminal_group_command_update`

Update a named command under a terminal group.

Input:

- `groupId` required: terminal group id.
- `commandId` required: terminal group command id.
- `name` required: command display name.
- `command` required: multi-line command text.

Output:

- Terminal group command.

`app_terminal_group_command_delete`

Delete a named command from a terminal group.

Input:

- `groupId` required: terminal group id.
- `commandId` required: terminal group command id.

Output:

- `{ "ok": true }`

`app_terminal_group_command_launch`

Create a new terminal session from a named command and run it in the group default directory.

Input:

- `groupId` required: terminal group id.
- `commandId` required: terminal group command id.
- `cols` optional: terminal columns. Defaults to `80`.
- `rows` optional: terminal rows. Defaults to `24`.

Output:

- Terminal session.

`app_terminal_group_delete`

Delete a terminal group and every terminal session in it. Running sessions are stopped before deletion.

Input:

- `groupId` required: terminal group id.

Output:

- `{ "ok": true }`

`app_terminal_session_create`

Create a Synapse-managed terminal session using the user's default shell.

Input:

- `groupId` optional: terminal group id.
- `title` optional: session title.
- `cwd` optional: existing absolute working directory.
- `cols` optional: terminal columns. Defaults to `80`.
- `rows` optional: terminal rows. Defaults to `24`.

Output:

- Terminal session.

`app_terminal_session_list`

List terminal sessions.

Input: none.

Output:

- Terminal sessions.

`app_terminal_session_get`

Get terminal session status.

Input:

- `sessionId` required: terminal session id.

Output:

- Terminal session.

`app_terminal_session_read`

Read retained terminal output.

Input:

- `sessionId` required: terminal session id.
- `afterSeq` optional: return output after this sequence.
- `limitBytes` optional: maximum bytes to read. Maximum `1048576`.

Output:

- `session`: terminal session.
- `chunks`: retained output chunks.
- `nextSeq`: next output sequence cursor.
- `firstSeq`: first retained sequence.
- `truncated`: whether retention trimmed earlier output.

`app_terminal_session_rename`

Rename a terminal session.

Input:

- `sessionId` required: terminal session id.
- `title` required: new session title. Leading and trailing whitespace is trimmed.

Output:

- Terminal session.

`app_terminal_session_write`

Write raw input to a Synapse terminal session. Include `\n` to submit a shell command.

Input:

- `sessionId` required: terminal session id.
- `data` required: raw terminal input.

Output:

- `{ "ok": true }`

`app_terminal_session_resize`

Resize a running terminal session.

Input:

- `sessionId` required: terminal session id.
- `cols` required: terminal columns.
- `rows` required: terminal rows.

Output:

- `{ "ok": true }`

`app_terminal_session_delete`

Delete a terminal session and its retained output. Running sessions are stopped before deletion.

Input:

- `sessionId` required: terminal session id.

Output:

- `{ "ok": true }`

`app_terminal_session_stop`

Stop a Synapse terminal session.

Input:

- `sessionId` required: terminal session id.
- `force` optional: force stop when supported.

Output:

- `{ "ok": true }`

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
