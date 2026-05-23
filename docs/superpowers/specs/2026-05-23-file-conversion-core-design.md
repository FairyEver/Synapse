# File Conversion Core Design

## Goal

Add a Synapse-owned local file conversion capability that extracts useful text and structure from documents, spreadsheets, PDFs, and presentations.

This capability must be independent from Knowledge Base. Knowledge Base will be one consumer that stages converted output into `.raw/`, and future Workflow nodes or other modules can call the same conversion service directly.

## Background

The current Knowledge Base source pipeline only scans local text-like files in `.raw/`:

- Markdown and plain text.
- CSV, JSON, YAML.
- HTML and XML.

Files such as `.doc`, `.docx`, `.xlsx`, `.pdf`, `.ppt`, and `.pptx` can be copied into `.raw/`, but `source-scan` marks them as unsupported because they are not deterministic text sources. That is correct for the scanner; binary and structured formats need an extraction step before ingest.

The new design separates concerns:

```text
User file
  -> common local conversion service
  -> normalized extracted document
  -> consumer-specific staging

Knowledge Base consumer:
  -> copy original to _attachments/originals/
  -> write generated Markdown to .raw/<kind>/
  -> let existing source-scan and /wiki ingest handle Markdown

Future Workflow consumer:
  -> call conversion service
  -> pass text/markdown/metadata to next node
```

## Hard Rules

- Conversion is local-only. Do not use online APIs for parsing, OCR, vision, or document conversion.
- The common conversion service must not depend on Knowledge Base types, `.raw`, `.manifest.json`, `wiki/`, or Agent prompts.
- Knowledge Base must not teach Agent skills how to parse binary Office/PDF files. Parsing belongs in deterministic Electron services.
- Knowledge Base user vaults must remain data-only. Do not write converter scripts, Agent skills, hooks, commands, plugins, or full runtime prompts into the vault.
- Original uploaded files must not be modified.
- Generated Knowledge Base Markdown may be written under `.raw/`; originals should be archived under `_attachments/originals/`.
- If a file is encrypted, password-protected, malformed, or depends on a missing local helper, fail explicitly with a structured reason. Do not silently import partial garbage as if it were complete.
- Ordinary Agent conversations, Scheduler, and Workflow must not load Knowledge Base-specific plugin/skill/hook behavior. They may call the common conversion service once that service is exposed through their own explicit integration.

## Supported Formats

Initial target formats:

| Extension | Target support | Primary local strategy | Notes |
| --- | --- | --- | --- |
| `.docx` | Full text + headings + tables where available | Mammoth for semantic HTML/text, with Markdown normalization | Good first-class path for modern Word documents. |
| `.doc` | Text + basic metadata | Apache Tika local helper, fallback to LibreOffice headless when available | Legacy binary Office requires a local external helper; pure JS support is not reliable enough. |
| `.xlsx` | Sheets, rows, formulas/value metadata where available | SheetJS `xlsx`, with optional ExcelJS comparison for workbook details | Convert each sheet to Markdown tables with size limits. |
| `.pdf` | Text PDFs + page metadata | PDF.js or `pdf-parse` for text extraction | OCR/scanned PDF is out of the first conversion slice. |
| `.pptx` | Slide titles/body text/speaker notes where available | officeParser or a focused PPTX parser | Preserve slide boundaries in Markdown. |
| `.ppt` | Slide text + basic metadata | Apache Tika local helper, fallback to LibreOffice headless when available | Legacy binary PowerPoint follows the same helper path as `.doc`. |

The library baseline is based on current local/open-source research:

- Mammoth converts `.docx` into clean semantic HTML and is a mature open-source option.
- SheetJS is the most widely used JavaScript spreadsheet toolkit; ExcelJS is also popular and useful when workbook details matter.
- PDF.js is Mozilla's local PDF engine; `pdf-parse` is a smaller Node text-extraction wrapper when layout is not needed.
- officeParser supports modern Office and PDF text extraction, but its repository is much smaller; use it cautiously for `.pptx` rather than making it the whole system boundary.
- Apache Tika supports both legacy OLE2 Office formats and OOXML/PDF through local parsers, which makes it the pragmatic local fallback for `.doc` and `.ppt`.

## Non-Goals

- No OCR for scanned PDFs or images in the first slice.
- No online vision model or online document parser.
- No pixel-perfect layout reconstruction.
- No editor preview UI in this spec.
- No Workflow node UI in the first implementation plan; the service boundary must make it easy later.
- No automatic Agent ingest of unsupported binaries without deterministic conversion first.
- No permanent dependency on Knowledge Base names in common converter APIs.

## Architecture

### Common Service

Add a new Electron main-process service namespace:

```text
desktop/electron/services/file-conversion/
  types.ts
  registry.ts
  service.ts
  markdown.ts
  extractors/
    docx.ts
    legacy-office.ts
    xlsx.ts
    pdf.ts
    pptx.ts
  __tests__/
```

Core API:

```ts
export type FileConversionKind =
  | "document"
  | "spreadsheet"
  | "pdf"
  | "presentation"

export type FileConversionFormat =
  | "doc"
  | "docx"
  | "xlsx"
  | "pdf"
  | "ppt"
  | "pptx"

export interface FileConversionInput {
  readonly filePath: string
  readonly preferredOutput?: "markdown" | "text"
}

export interface FileConversionResult {
  readonly sourcePath: string
  readonly format: FileConversionFormat
  readonly kind: FileConversionKind
  readonly title: string
  readonly markdown: string
  readonly text: string
  readonly metadata: Record<string, unknown>
  readonly warnings: readonly FileConversionWarning[]
}

export interface FileConversionWarning {
  readonly code: string
  readonly message: string
}
```

Failure should be structured:

```ts
export type FileConversionErrorCode =
  | "unsupported_format"
  | "encrypted"
  | "missing_local_helper"
  | "parse_failed"
  | "read_failed"
  | "size_limit_exceeded"

export class FileConversionError extends Error {
  readonly code: FileConversionErrorCode
}
```

### Extractor Registry

Each extractor has one responsibility:

```ts
export interface FileExtractor {
  readonly formats: readonly FileConversionFormat[]
  extract(input: FileConversionInput): Promise<FileConversionResult>
}
```

`FileConversionService` determines the extension, picks an extractor, enforces size/path/read checks, and normalizes failures.

### Markdown Normalization

All extractors return Markdown as the stable interchange output. Markdown should be conservative:

- Preserve document title and headings.
- Preserve page/sheet/slide boundaries.
- Keep tables readable.
- Include source metadata in frontmatter-like comments or a short metadata section only if useful for downstream processing.
- Avoid embedding binary media in Markdown in the first slice.

Example presentation output:

```md
# Quarterly Review

## Slide 1: Overview

Revenue grew 12%.

## Slide 2: Risks

- Renewal delay in APAC
- Hiring plan moved to Q3
```

Example spreadsheet output:

```md
# budget.xlsx

## Sheet: Summary

| Department | Budget | Actual |
| --- | ---: | ---: |
| Product | 120000 | 118500 |
```

## Knowledge Base Integration

Knowledge Base gets a thin staging adapter, not its own parsers:

```text
desktop/electron/services/knowledge-base/source-staging.ts
```

Responsibilities:

1. Accept uploaded paths.
2. Copy originals into `_attachments/originals/YYYY/MM/DD/` with collision-safe names.
3. For text-supported files, keep current behavior: copy into `.raw/YYYY/MM/DD/`.
4. For convertible files, call `FileConversionService`.
5. Write generated Markdown to:
   - `.raw/documents/YYYY/MM/DD/<name>.md`
   - `.raw/spreadsheets/YYYY/MM/DD/<name>.md`
   - `.raw/pdfs/YYYY/MM/DD/<name>.md`
   - `.raw/presentations/YYYY/MM/DD/<name>.md`
6. Include a short source pointer in the generated Markdown:

```md
---
source_original: "_attachments/originals/2026/05/23/report.docx"
source_format: "docx"
converted_at: "2026-05-23T13:00:00.000Z"
---
```

7. Return upload results that include both original and generated paths.

The existing `scanKnowledgeBaseSources()` should continue to scan generated Markdown. It should not parse binary files.

## Future Workflow Integration

The common service should be callable from a future Workflow node:

```text
File input -> Convert File node -> markdown/text/metadata output
```

That future node should depend on `FileConversionService`, not on Knowledge Base staging. This is the main reason the conversion API returns normalized text, Markdown, metadata, and warnings instead of `.raw` paths.

## Dependency Policy

Because root `AGENTS.md` says not to add dependencies unless required or approved, implementation must keep dependency additions explicit and scoped.

Preferred dependency set:

- `mammoth` for `.docx`.
- `xlsx` for `.xlsx`.
- One PDF text extractor: start with `pdf-parse` if plain text is enough, or `pdfjs-dist` if page-level control is needed.
- One PPTX extractor: start with `officeparser` or a focused PPTX parser after a small spike test.
- Apache Tika local helper for `.doc` and `.ppt`. Treat helper availability as a product packaging decision; the service must expose `missing_local_helper` until the helper is packaged or configured.

Do not add multiple overlapping libraries for the same format in the first implementation unless a test fixture proves a single library cannot meet the requirement.

## Error Handling

User-facing states should distinguish:

- Unsupported extension.
- Supported extension but missing local helper.
- Parse failure.
- Encrypted/password-protected file.
- Size limit exceeded.
- Successful conversion with warnings.

Knowledge Base source manager can display converted files as normal pending Markdown sources, while original binaries can display as archived originals or converted originals rather than unsupported ingest items.

## Safety And Limits

Initial limits:

- Reject files above a configured size threshold before parsing.
- Limit spreadsheet rows rendered per sheet in Markdown, with a warning when truncated.
- Limit PDF pages parsed in one operation if needed.
- Ignore symlinks in Knowledge Base staging paths.
- Keep all writes inside the selected Knowledge Base project path.
- Do not write generated Markdown over existing files; use collision-safe names.

## Testing Strategy

Common service tests:

- Detect supported extensions.
- Convert fixture `.docx` to Markdown.
- Convert fixture `.xlsx` with multiple sheets.
- Convert fixture text `.pdf` with page boundaries.
- Convert fixture `.pptx` with slide boundaries.
- Return `missing_local_helper` for `.doc` and `.ppt` when no local helper is configured.
- Convert `.doc` and `.ppt` through a stubbed local helper path.
- Return structured parse errors for malformed files.

Knowledge Base staging tests:

- Uploading `.docx` copies original to `_attachments/originals/` and generated Markdown to `.raw/documents/`.
- Uploading `.xlsx` writes `.raw/spreadsheets/...md`.
- Uploading `.pdf` writes `.raw/pdfs/...md`.
- Uploading `.pptx` writes `.raw/presentations/...md`.
- Existing text uploads still copy to `.raw/YYYY/MM/DD/`.
- Generated Markdown appears as supported in `listSources()`.
- Original files are not overwritten.
- User vault still does not contain converter scripts, Agent skills, commands, hooks, or plugins.

## Initial Implementation Slice

The first implementation should stop at:

1. Common conversion service API and registry.
2. Modern-format extractors for `.docx`, `.xlsx`, `.pdf`, and `.pptx`.
3. Legacy `.doc` and `.ppt` helper boundary with structured `missing_local_helper` and stubbed-helper tests.
4. Knowledge Base source staging adapter that calls the common service and writes generated Markdown into `.raw`.
5. Focused tests proving Knowledge Base remains a consumer, not the owner of conversion logic.

OCR, image understanding, Workflow node UI, and packaging a bundled Tika runtime can be follow-up specs.

## References

- Mammoth: https://github.com/mwilliamson/mammoth.js
- SheetJS: https://github.com/SheetJS/sheetjs
- ExcelJS: https://github.com/exceljs/exceljs
- PDF.js: https://mozilla.github.io/pdf.js/
- officeParser: https://github.com/harshankur/officeParser
- Apache Tika supported formats: https://tika.apache.org/3.2.2/formats.html
