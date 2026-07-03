# Synapse App MCP API Reference

## `app_document_template_docx_generate`

Generate a local `.docx` file from a local `.docx` template and JSON object data.

Input:

- `templatePath` required: absolute local `.docx` template path.
- `outputPath` required: absolute local `.docx` output path.
- `dataPath` optional: absolute local `.json` file path. Mutually exclusive with `data`.
- `data` optional: inline JSON object. Mutually exclusive with `dataPath`.
- `overwrite` optional: when `true`, replace an existing output file. Defaults to `false`.

Output:

- `outputPath`: generated file path.
- `fileName`: generated file name.
- `size`: generated file size in bytes.
- `generatedAt`: ISO timestamp.

## Terminal

`app_terminal_group_create`

Create a terminal group.

Input:

- `name` required: group name.

Output:

- Terminal group.

`app_terminal_group_list`

List terminal groups.

Input: none.

Output:

- Terminal groups.

`app_terminal_group_rename`

Rename a terminal group.

Input:

- `groupId` required: terminal group id.
- `name` required: new group name. Leading and trailing whitespace is trimmed.

Output:

- Terminal group.

`app_terminal_group_updateSettings`

Update a terminal group's name and default working directory.

Input:

- `groupId` required: terminal group id.
- `name` required: group name. Leading and trailing whitespace is trimmed.
- `settings.defaultCwd` optional: absolute working directory for future sessions in this group.

Output:

- Terminal group.

`app_terminal_groupCommand_create`

Create a named command under a terminal group.

Input:

- `groupId` required: terminal group id.
- `name` required: command display name.
- `command` required: multi-line command text.

Output:

- Terminal group command.

`app_terminal_groupCommand_update`

Update a named command under a terminal group.

Input:

- `groupId` required: terminal group id.
- `commandId` required: terminal group command id.
- `name` required: command display name.
- `command` required: multi-line command text.

Output:

- Terminal group command.

`app_terminal_groupCommand_delete`

Delete a named command from a terminal group.

Input:

- `groupId` required: terminal group id.
- `commandId` required: terminal group command id.

Output:

- `{ "ok": true }`

`app_terminal_groupCommand_launch`

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

## `app_screenshot_capture`

Capture a fullscreen or coordinate-region PNG screenshot. Fullscreen captures use the current focused Synapse window's screen when available, otherwise the primary screen.

This tool is permission-checked and audited before capture.

Input:

- `mode` required: `"fullscreen"` or `"region"`.
- `region` required when `mode` is `"region"`:
  - `x`: left screen coordinate.
  - `y`: top screen coordinate.
  - `width`: region width in screen coordinates.
  - `height`: region height in screen coordinates.
- `hideCurrentWindow` optional: hide the current focused Synapse window before capture when available.

Output:

- `id`: screenshot artifact id.
- `mimeType`: always `"image/png"`.
- `size`: PNG size in bytes.
- `width`: image width.
- `height`: image height.
- `tempPath`: temporary local PNG path.
- `capture`: capture metadata, including mode, region when present, coordinate space, display id when known, scale factor when known, and capture time.

## `app_screenshot_file_save`

Capture a fullscreen or coordinate-region PNG screenshot and save it to a local `.png` file.

Input:

- `capture` required: same capture input shape as `app_screenshot_capture`.
- `outputPath` required: absolute local `.png` output path.
- `overwrite` optional: when `true`, replace an existing output file. Defaults to `false`.

Output:

- `outputPath`: saved file path.
- `fileName`: saved file name.
- `size`: saved file size in bytes.
- `artifact`: screenshot artifact metadata without raw image bytes.

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
