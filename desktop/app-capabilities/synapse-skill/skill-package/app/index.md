# Synapse App MCP

Use App MCP tools for capabilities provided by Synapse system apps.

## Document Text Extraction

Use `app_document_text_extractor_document_extract` when the user asks to extract text from a local PDF or DOCX document.

Rules:

- Pass one absolute local `.pdf` or `.docx` path as `filePath`; the extension is case-insensitive and must match the document content.
- For PDF, the tool reads the existing text layer. For DOCX, it reads the main document's paragraphs, list text, table cells, and recognizable text boxes.
- Treat `text: ""` as a successful result when a supported document has no extractable text.
- Do not promise DOCX header, footer, comment, footnote, endnote, or image text.
- Do not use this tool for OCR, scanned-image recognition, semantic rewriting, or layout reconstruction.
- Preserve the returned full text unless the user asks for a summary or transformation.
- Do not repeat the full source path or extracted text unnecessarily in the final answer.
- Surface stable error codes when extraction fails; do not claim partial success because limits never truncate silently.

## Document Template

Use `app_document_template_docx_generate` when the user asks to generate a Word `.docx` document from a `.docx` template and JSON data.

Rules:

- Provide exactly one of `dataPath` or `data`.
- Use local absolute paths for `templatePath`, `dataPath`, and `outputPath`.
- Do not overwrite an existing output file unless the user explicitly asks to replace it.
- Do not use a symbolic link as `outputPath`; Document Template always rejects symbolic-link outputs.
- Do not rewrite or enrich JSON data before calling the tool. Pass the user data as-is.
- Do not repeat large JSON payloads or secret-looking values in the final answer.

## Terminal

Use Terminal tools when you need to work inside a Synapse-managed shell session.

Rules:

- Create a session with `app_terminal_session_create`, then read retained output with `app_terminal_session_read`.
- Use `app_terminal_group_list` when you need group ids or saved command settings. The read requires terminal permission approval.
- Use `app_terminal_group_create`, `app_terminal_group_update_settings`, `app_terminal_group_rename`, and `app_terminal_group_delete` to organize sessions. Creating or renaming a group requires terminal permission approval.
- Use `app_terminal_group_update_settings` when future sessions in a group should start from a default directory.
- Use `app_terminal_group_command_create`, `app_terminal_group_command_update`, and `app_terminal_group_command_delete` to manage saved commands in a group.
- Use `app_terminal_group_command_launch` when the user asks to run a saved terminal command.
- Use `afterSeq` from prior reads to avoid rereading the same output.
- `app_terminal_session_write` writes raw terminal input; include `\n` when the shell should submit a command.
- Use `app_terminal_session_rename` for display names and `app_terminal_session_delete` to remove a session plus retained output.
- Deleting a terminal group removes every session in it. Running sessions are stopped before deletion.
- Deleting a running terminal session stops it before removing the record.
- Do not use Terminal tools as a broad command runner when a narrower MCP tool exists.

## Sound Notifier

Use `app_sound_notifier_sound_play` when the user asks to play a local sound reminder, remind them with sound, or notify them that an Agent or command needs attention.

Rules:

- Choose `eventType` by situation: `message` for ordinary updates, `input-required` when user input or confirmation is needed, `success` for normal completion, `long-running-complete` for builds/tests/installs or other long tasks, and `error` for failures or blockers.
- Use legacy `presetId` only when the user explicitly asks for a specific preset id.
- Use `repeatCount` and `intervalMs` when the user asks to be reminded multiple times or after a specific spacing.
- Do not call this repeatedly in a loop. One multi-reminder request should use one call with `repeatCount`.
