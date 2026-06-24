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
- Use `afterSeq` from prior reads to avoid rereading the same output.
- `app_terminal_session_write` writes raw terminal input; include `\n` when the shell should submit a command.
- `app_terminal_session_write` and `app_terminal_session_stop` require Agent control to be enabled on the session.
- Do not use Terminal tools as a broad command runner when a narrower MCP tool exists.
