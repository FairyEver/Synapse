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
