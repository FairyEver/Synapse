# Synapse App MCP

Use App MCP tools for capabilities provided by Synapse system apps.

## Text File Writer

Use `app_text_file_writer_file_write` when the user asks to save a complete text value as a local `.txt`, `.md`, `.csv`, `.html`, or `.htm` file.

Rules:

- Pass the complete string once as `text` and one current-OS absolute path as `path`; do not split or reconstruct the content through shell commands.
- The final path extension selects the format. Do not send a separate format field, add an extension, or rewrite the content.
- Use `utf8` or `utf16le` for `.txt`, `.md`, and `.csv`. HTML targets accept only `utf8`. Omit `encoding` for UTF-8. Synapse does not add a BOM, trim text, normalize newlines, or append a final newline. Empty text is valid.
- Omit `overwrite` unless the caller explicitly authorizes replacement. A changed target returns retryable `TARGET_CHANGED`; do not silently retry over the newer file.
- Missing parent directories are created automatically. Do not pass `~`, environment variables, shell expressions, or `file://` URLs.
- Do not repeat the original text, complete path, or native failure details in logs or the final answer unless the user specifically needs the resulting path.

## HTML Generator

Use `app_html_generator_ejs_generate` to render a trusted EJS template and return the complete HTML string without automatically saving or opening it. Use `app_html_generator_ejs_file_generate` when the rendered result must be written directly to an absolute `.html` or `.htm` path.

Rules:

- EJS templates execute JavaScript in a one-shot Worker that shares the application's permission domain; it is a reliability boundary, not a security sandbox. Use only trusted template content.
- Pass the template string as `template` and a JSON-compatible top-level object as `data`. Templates access values through the explicit `data` root, such as `<%= data.title %>`.
- EJS include and template file loading are disabled. Do not pass a template path, EJS options, custom delimiters, encoding, or a mode field.
- String generation returns the complete HTML and UTF-8 byte size. It does not automatically save, open, preview, sanitize, or validate the HTML.
- File generation accepts only an absolute `.html` or `.htm` `outputPath`, always writes UTF-8, and defaults `overwrite` to `false`. It returns only the committed file metadata.
- Rendering is bounded by fixed input, output, queue, Worker startup, execution, and memory limits. Surface the stable normalized error instead of retrying automatically; only `RENDER_QUEUE_FULL` is retryable.

## File Opener

Use `app_file_opener_file_open` when the user asks to open one local file with the operating system's default application.

Rules:

- Pass exactly one existing absolute local regular-file path as `path`.
- Do not pass URLs, `file://` values, directories, symbolic links, multiple files, or an application choice.
- Success means the operating system accepted the request; it does not guarantee that the external application launched, focused, or loaded the file.
- Surface the stable error code on failure. Do not report a failed request as successful.
- The matching deep link is `synapse://app/file-opener/open?path=<percent-encoded-absolute-path>`.

## Text Extraction

Use `app_text_extractor_document_extract` when the user asks to extract text from a local PDF or DOCX document.
Use `app_text_extractor_document_extract_to_file` when the user wants that text written directly to a local `.txt`, `.md`, or `.csv` file without returning the document body through MCP.

Rules:

- Pass one absolute local `.pdf` or `.docx` path as `filePath`; the extension is case-insensitive and must match the document content.
- For PDF, the tool reads the existing text layer. For DOCX, it reads the main document's paragraphs, list text, table cells, and recognizable text boxes.
- Treat `text: ""` as a successful result when a supported document has no extractable text.
- Do not promise DOCX header, footer, comment, footnote, endnote, or image text.
- Do not use this tool for OCR, scanned-image recognition, semantic rewriting, or layout reconstruction.
- Preserve the returned full text unless the user asks for a summary or transformation.
- Do not repeat the full source path or extracted text unnecessarily in the final answer.
- Surface stable error codes when extraction fails; do not claim partial success because limits never truncate silently.
- Treat `PERMISSION_DENIED` as a denied local-file read and ask the user to choose or authorize an accessible document; do not retry around the permission boundary.
- For direct output, pass `filePath` and `outputPath` once. Omit `encoding` for UTF-8 and omit `overwrite` unless replacement is explicitly authorized.
- The direct-output tool performs extraction and atomic writing inside Synapse, returns only source/output metadata, and never returns the extracted body. Do not call `app_text_file_writer_file_write` afterward.
- Direct output still performs separate local-file read and write permission checks. A write failure does not create a partial target file.

## Document Template

Use `app_document_template_docx_generate` when the user asks to generate a Word `.docx` document from a `.docx` template and JSON data.

Rules:

- Provide exactly one of `dataPath` or `data`.
- Use local absolute paths for `templatePath`, `dataPath`, and `outputPath`.
- Do not overwrite an existing output file unless the user explicitly asks to replace it.
- Do not use a symbolic link as `outputPath`; Document Template always rejects symbolic-link outputs.
- Do not rewrite or enrich JSON data before calling the tool. Pass the user data as-is.
- Do not repeat large JSON payloads or secret-looking values in the final answer.

## Sound Notifier

Use `app_sound_notifier_sound_play` when the user asks to play a local sound reminder, remind them with sound, or notify them that an Agent or command needs attention.

Rules:

- Choose `eventType` by situation: `message` for ordinary updates, `input-required` when user input or confirmation is needed, `success` for normal completion, `long-running-complete` for builds/tests/installs or other long tasks, and `error` for failures or blockers.
- Use legacy `presetId` only when the user explicitly asks for a specific preset id.
- Use `repeatCount` and `intervalMs` when the user asks to be reminded multiple times or after a specific spacing.
- Do not call this repeatedly in a loop. One multi-reminder request should use one call with `repeatCount`.
