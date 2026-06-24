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

## Screenshot

Use `app_screenshot_capture` when the user asks to take a fullscreen screenshot or a screenshot from explicit screen coordinates.

Use `app_screenshot_file_save` when the user asks to save the screenshot to a specific `.png` path.

Rules:

- For region screenshots, provide screen coordinates as `x`, `y`, `width`, and `height`.
- Use `mode: "fullscreen"` when the user does not provide coordinates. Fullscreen captures use the current focused Synapse window's screen when available, otherwise the primary screen.
- Set `hideCurrentWindow: true` when the user asks to exclude the current Synapse window from the screenshot.
- Treat `tempPath` as a temporary local artifact path, not a permanent user file.
- Use `app_screenshot_file_save` for durable output. Do not overwrite an existing output file unless the user explicitly asks to replace it.
- MCP screenshot tools return metadata and local paths, not raw image bytes.
