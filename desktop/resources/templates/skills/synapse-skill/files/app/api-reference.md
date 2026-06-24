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

## `app_screenshot_capture`

Capture a fullscreen or coordinate-region PNG screenshot. Fullscreen captures use the current focused Synapse window's screen when available, otherwise the primary screen.

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
