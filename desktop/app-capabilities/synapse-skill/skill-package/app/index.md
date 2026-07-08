# Synapse App MCP

Use App MCP tools for capabilities provided by Synapse system apps.

## Document Template

Use `app_document_template_docx_generate` when the user asks to generate a Word `.docx` document from a `.docx` template and JSON data.

Rules:

- Provide exactly one of `dataPath` or `data`.
- Use local absolute paths for `templatePath`, `dataPath`, and `outputPath`.
- Do not overwrite an existing output file unless the user explicitly asks to replace it.
- Do not rewrite or enrich JSON data before calling the tool. Pass the user data as-is.
- Do not repeat large JSON payloads or secret-looking values in the final answer.

## Terminal

Use Terminal tools when you need to work inside a Synapse-managed shell session.

Rules:

- Create a session with `app_terminal_session_create`, then read retained output with `app_terminal_session_read`.
- Use `app_terminal_group_create`, `app_terminal_group_updateSettings`, `app_terminal_group_rename`, and `app_terminal_group_delete` to organize sessions.
- Use `app_terminal_group_updateSettings` when future sessions in a group should start from a default directory.
- Use `app_terminal_groupCommand_create`, `app_terminal_groupCommand_update`, and `app_terminal_groupCommand_delete` to manage saved commands in a group.
- Use `app_terminal_groupCommand_launch` when the user asks to run a saved terminal command.
- Use `afterSeq` from prior reads to avoid rereading the same output.
- `app_terminal_session_write` writes raw terminal input; include `\n` when the shell should submit a command.
- Use `app_terminal_session_rename` for display names and `app_terminal_session_delete` to remove a session plus retained output.
- Deleting a terminal group removes every session in it. Running sessions are stopped before deletion.
- Deleting a running terminal session stops it before removing the record.
- Do not use Terminal tools as a broad command runner when a narrower MCP tool exists.

## Screenshot

Use `app_screenshot_capture` when the user asks to take a fullscreen screenshot or a screenshot from explicit screen coordinates.

Use `app_screenshot_file_save` when the user asks to save the screenshot to a specific `.png` path.

Rules:

- For region screenshots, provide screen coordinates as `x`, `y`, `width`, and `height`.
- Use `mode: "fullscreen"` when the user does not provide coordinates. Fullscreen captures use the current focused Synapse window's screen when available, otherwise the primary screen.
- Set `hideCurrentWindow: true` when the user asks to exclude the current Synapse window from the screenshot.
- Screenshot capture requests are permission-checked and audited.
- Treat `tempPath` as a temporary local artifact path, not a permanent user file.
- Use `app_screenshot_file_save` for durable output. Do not overwrite an existing output file unless the user explicitly asks to replace it.
- MCP screenshot tools return metadata and local paths, not raw image bytes.

## Sound Notifier

Use `app_sound_notifier_sound_play` when the user asks to play a local sound reminder, remind them with sound, or notify them that an Agent or command needs attention.

Rules:

- Choose `eventType` by situation: `message` for ordinary updates, `input-required` when user input or confirmation is needed, `success` for normal completion, `long-running-complete` for builds/tests/installs or other long tasks, and `error` for failures or blockers.
- Use legacy `presetId` only when the user explicitly asks for a specific preset id.
- Use `repeatCount` and `intervalMs` when the user asks to be reminded multiple times or after a specific spacing.
- Do not call this repeatedly in a loop. One multi-reminder request should use one call with `repeatCount`.
