# File Conversion Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Knowledge Base-independent local file conversion service, then let Knowledge Base stage converted Office/PDF/PPT output as Markdown sources.

**Architecture:** Add `desktop/electron/services/file-conversion/` as the common service and keep Knowledge Base integration in `desktop/electron/services/knowledge-base/source-staging.ts`. The common service extracts Markdown/text/metadata from supported formats; Knowledge Base copies originals to `_attachments/originals/` and writes generated Markdown into `.raw/<kind>/`.

**Tech Stack:** Electron main process, TypeScript, Node filesystem APIs, Vitest, local open-source parsers (`mammoth`, `xlsx`, one PDF extractor, one PPTX extractor), optional local helper boundary for Apache Tika/LibreOffice.

---

## File Structure

Create:

- `desktop/electron/services/file-conversion/types.ts` — shared conversion types and structured error class.
- `desktop/electron/services/file-conversion/markdown.ts` — Markdown escaping, title cleanup, table rendering, and frontmatter serialization helpers.
- `desktop/electron/services/file-conversion/registry.ts` — extractor registry and extension-to-format resolution.
- `desktop/electron/services/file-conversion/service.ts` — main `FileConversionService`.
- `desktop/electron/services/file-conversion/extractors/docx.ts` — `.docx` extractor.
- `desktop/electron/services/file-conversion/extractors/xlsx.ts` — `.xlsx` extractor.
- `desktop/electron/services/file-conversion/extractors/pdf.ts` — `.pdf` extractor.
- `desktop/electron/services/file-conversion/extractors/pptx.ts` — `.pptx` extractor.
- `desktop/electron/services/file-conversion/extractors/legacy-office.ts` — `.doc` and `.ppt` local-helper extractor boundary.
- `desktop/electron/services/file-conversion/index.ts` — public barrel.
- `desktop/electron/services/file-conversion/__tests__/file-conversion-service.test.ts` — common service tests.
- `desktop/electron/services/file-conversion/__tests__/markdown.test.ts` — Markdown helper tests.
- `desktop/electron/services/knowledge-base/source-staging.ts` — Knowledge Base staging adapter.
- `desktop/electron/services/knowledge-base/__tests__/source-staging.test.ts` — staging tests.

Modify:

- `desktop/electron/services/knowledge-base/knowledge-base-service.ts` — delegate upload logic to staging.
- `desktop/src/types/knowledge-base.ts` — include generated conversion paths and new skip reason.
- `desktop/electron/modules/knowledge-base/ipc.ts` — update schemas for richer upload results.
- `desktop/package.json` — add parser dependencies only after tests describe the behavior they are needed for.

### Task 1: Define The Common Conversion Contract

**Files:**
- Create: `desktop/electron/services/file-conversion/types.ts`
- Create: `desktop/electron/services/file-conversion/index.ts`
- Test: `desktop/electron/services/file-conversion/__tests__/file-conversion-service.test.ts`

- [ ] **Step 1: Write the failing type/export test**

Create `desktop/electron/services/file-conversion/__tests__/file-conversion-service.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  FileConversionError,
  type FileConversionFormat,
  type FileConversionResult,
} from "../index"

describe("file conversion contract", () => {
  it("exports supported file formats and structured errors", () => {
    const format: FileConversionFormat = "docx"
    const result: FileConversionResult = {
      sourcePath: "/tmp/report.docx",
      format,
      kind: "document",
      title: "report.docx",
      markdown: "# report.docx\n",
      text: "report.docx",
      metadata: {},
      warnings: [],
    }
    const error = new FileConversionError("unsupported_format", "Unsupported file format")

    expect(result.format).toBe("docx")
    expect(error.code).toBe("unsupported_format")
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-service.test.ts
```

Expected: FAIL because `../index` does not exist.

- [ ] **Step 3: Add the contract files**

Create `desktop/electron/services/file-conversion/types.ts`:

```ts
export type FileConversionKind = "document" | "spreadsheet" | "pdf" | "presentation"

export type FileConversionFormat = "doc" | "docx" | "xlsx" | "pdf" | "ppt" | "pptx"

export interface FileConversionInput {
  readonly filePath: string
  readonly preferredOutput?: "markdown" | "text"
}

export interface FileConversionWarning {
  readonly code: string
  readonly message: string
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

export type FileConversionErrorCode =
  | "unsupported_format"
  | "encrypted"
  | "missing_local_helper"
  | "parse_failed"
  | "read_failed"
  | "size_limit_exceeded"

export class FileConversionError extends Error {
  readonly code: FileConversionErrorCode

  constructor(code: FileConversionErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message)
    this.name = "FileConversionError"
    this.code = code
    if (options && "cause" in options) {
      this.cause = options.cause
    }
  }
}

export interface FileExtractor {
  readonly formats: readonly FileConversionFormat[]
  extract(input: FileConversionInput): Promise<FileConversionResult>
}
```

Create `desktop/electron/services/file-conversion/index.ts`:

```ts
export {
  FileConversionError,
  type FileConversionErrorCode,
  type FileConversionFormat,
  type FileConversionInput,
  type FileConversionKind,
  type FileConversionResult,
  type FileConversionWarning,
  type FileExtractor,
} from "./types"
```

- [ ] **Step 4: Run the contract test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/file-conversion
git commit -m "feat(file-conversion): define conversion contract"
```

### Task 2: Add Markdown Helpers

**Files:**
- Create: `desktop/electron/services/file-conversion/markdown.ts`
- Test: `desktop/electron/services/file-conversion/__tests__/markdown.test.ts`

- [ ] **Step 1: Write failing Markdown helper tests**

Create `desktop/electron/services/file-conversion/__tests__/markdown.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { markdownTable, normalizeMarkdownTitle, sourceFrontmatter } from "../markdown"

describe("file conversion markdown helpers", () => {
  it("normalizes empty titles to the source file name", () => {
    expect(normalizeMarkdownTitle("", "/tmp/季度报告.docx")).toBe("季度报告.docx")
  })

  it("renders markdown tables with escaped cells", () => {
    expect(markdownTable([
      ["Name", "Value"],
      ["A|B", "12"],
    ])).toBe([
      "| Name | Value |",
      "| --- | --- |",
      "| A\\|B | 12 |",
      "",
    ].join("\n"))
  })

  it("serializes source conversion frontmatter", () => {
    expect(sourceFrontmatter({
      sourceOriginal: "_attachments/originals/2026/05/23/report.docx",
      sourceFormat: "docx",
      convertedAt: "2026-05-23T13:00:00.000Z",
    })).toContain('source_format: "docx"')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/markdown.test.ts
```

Expected: FAIL because `markdown.ts` does not exist.

- [ ] **Step 3: Implement helpers**

Create `desktop/electron/services/file-conversion/markdown.ts`:

```ts
import path from "node:path"

export function normalizeMarkdownTitle(title: string | null | undefined, sourcePath: string): string {
  const trimmed = title?.trim()
  return trimmed || path.basename(sourcePath)
}

export function markdownTable(rows: readonly (readonly unknown[])[]): string {
  if (rows.length === 0) return ""
  const width = Math.max(...rows.map((row) => row.length))
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => formatCell(row[index])))
  const header = normalized[0]
  const body = normalized.slice(1)
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
    "",
  ].join("\n")
}

export function sourceFrontmatter(input: {
  readonly sourceOriginal: string
  readonly sourceFormat: string
  readonly convertedAt: string
}): string {
  return [
    "---",
    `source_original: "${escapeYamlString(input.sourceOriginal)}"`,
    `source_format: "${escapeYamlString(input.sourceFormat)}"`,
    `converted_at: "${escapeYamlString(input.convertedAt)}"`,
    "---",
    "",
  ].join("\n")
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim()
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/markdown.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/file-conversion/markdown.ts desktop/electron/services/file-conversion/__tests__/markdown.test.ts
git commit -m "feat(file-conversion): add markdown helpers"
```

### Task 3: Add Registry And Service Skeleton

**Files:**
- Create: `desktop/electron/services/file-conversion/registry.ts`
- Create: `desktop/electron/services/file-conversion/service.ts`
- Modify: `desktop/electron/services/file-conversion/index.ts`
- Test: `desktop/electron/services/file-conversion/__tests__/file-conversion-service.test.ts`

- [ ] **Step 1: Add failing service tests**

Append to `file-conversion-service.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach } from "vitest"
import { FileConversionService } from "../index"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-convert-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

it("rejects unsupported extensions with a structured error", async () => {
  const root = await tempDir()
  const filePath = path.join(root, "image.png")
  await writeFile(filePath, "not supported")
  const service = new FileConversionService({ extractors: [] })

  await expect(service.convert({ filePath })).rejects.toMatchObject({ code: "unsupported_format" })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-service.test.ts --testNamePattern "unsupported extensions"
```

Expected: FAIL because `FileConversionService` does not exist.

- [ ] **Step 3: Implement registry and service skeleton**

Create `desktop/electron/services/file-conversion/registry.ts`:

```ts
import path from "node:path"
import { FileConversionError, type FileConversionFormat, type FileExtractor } from "./types"

const EXTENSION_FORMATS = new Map<string, FileConversionFormat>([
  [".doc", "doc"],
  [".docx", "docx"],
  [".xlsx", "xlsx"],
  [".pdf", "pdf"],
  [".ppt", "ppt"],
  [".pptx", "pptx"],
])

export function detectConversionFormat(filePath: string): FileConversionFormat {
  const format = EXTENSION_FORMATS.get(path.extname(filePath).toLowerCase())
  if (!format) {
    throw new FileConversionError("unsupported_format", `Unsupported file format: ${path.extname(filePath) || "unknown"}`)
  }
  return format
}

export class FileExtractorRegistry {
  private readonly byFormat = new Map<FileConversionFormat, FileExtractor>()

  constructor(extractors: readonly FileExtractor[]) {
    for (const extractor of extractors) {
      for (const format of extractor.formats) {
        this.byFormat.set(format, extractor)
      }
    }
  }

  get(format: FileConversionFormat): FileExtractor {
    const extractor = this.byFormat.get(format)
    if (!extractor) {
      throw new FileConversionError("missing_local_helper", `No extractor is available for ${format}.`)
    }
    return extractor
  }
}
```

Create `desktop/electron/services/file-conversion/service.ts`:

```ts
import { lstat } from "node:fs/promises"

import { detectConversionFormat, FileExtractorRegistry } from "./registry"
import { FileConversionError, type FileConversionInput, type FileConversionResult, type FileExtractor } from "./types"

export interface FileConversionServiceOptions {
  readonly extractors: readonly FileExtractor[]
  readonly maxBytes?: number
}

export class FileConversionService {
  private readonly registry: FileExtractorRegistry
  private readonly maxBytes: number

  constructor(options: FileConversionServiceOptions) {
    this.registry = new FileExtractorRegistry(options.extractors)
    this.maxBytes = options.maxBytes ?? 50 * 1024 * 1024
  }

  async convert(input: FileConversionInput): Promise<FileConversionResult> {
    const format = detectConversionFormat(input.filePath)
    const stat = await lstat(input.filePath).catch((error: unknown) => {
      throw new FileConversionError("read_failed", "Could not read source file.", { cause: error })
    })
    if (!stat.isFile()) {
      throw new FileConversionError("read_failed", "Source path is not a file.")
    }
    if (stat.size > this.maxBytes) {
      throw new FileConversionError("size_limit_exceeded", "Source file exceeds the conversion size limit.")
    }
    return this.registry.get(format).extract(input)
  }
}
```

Update `index.ts`:

```ts
export { detectConversionFormat, FileExtractorRegistry } from "./registry"
export { FileConversionService, type FileConversionServiceOptions } from "./service"
export {
  FileConversionError,
  type FileConversionErrorCode,
  type FileConversionFormat,
  type FileConversionInput,
  type FileConversionKind,
  type FileConversionResult,
  type FileConversionWarning,
  type FileExtractor,
} from "./types"
```

- [ ] **Step 4: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-service.test.ts
```

Expected: PASS for contract and unsupported extension tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/file-conversion
git commit -m "feat(file-conversion): add extractor registry"
```

### Task 4: Implement Modern Extractors Behind Tests

**Files:**
- Create: `desktop/electron/services/file-conversion/extractors/docx.ts`
- Create: `desktop/electron/services/file-conversion/extractors/xlsx.ts`
- Create: `desktop/electron/services/file-conversion/extractors/pdf.ts`
- Create: `desktop/electron/services/file-conversion/extractors/pptx.ts`
- Modify: `desktop/electron/services/file-conversion/index.ts`
- Modify: `desktop/package.json`
- Test: `desktop/electron/services/file-conversion/__tests__/file-conversion-service.test.ts`

- [ ] **Step 1: Add fixture-based tests**

Add tests that create small fixtures at runtime where possible:

```ts
it("converts xlsx workbooks into markdown tables", async () => {
  const root = await tempDir()
  const filePath = path.join(root, "budget.xlsx")
  const XLSX = await import("xlsx")
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Department", "Budget"],
    ["Product", 120000],
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, "Summary")
  XLSX.writeFile(workbook, filePath)

  const { createDefaultFileConversionService } = await import("../index")
  const result = await createDefaultFileConversionService().convert({ filePath })

  expect(result.format).toBe("xlsx")
  expect(result.kind).toBe("spreadsheet")
  expect(result.markdown).toContain("## Sheet: Summary")
  expect(result.markdown).toContain("| Product | 120000 |")
})
```

For `.docx`, `.pdf`, and `.pptx`, add minimal binary fixtures under `desktop/electron/services/file-conversion/__tests__/fixtures/` if runtime generation is too heavy. Each test should assert the stable structure, not every byte:

```ts
expect(result.markdown).toContain("#")
expect(result.text.length).toBeGreaterThan(0)
expect(result.warnings).toEqual(expect.any(Array))
```

- [ ] **Step 2: Run tests and verify dependency failures**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-service.test.ts --testNamePattern "converts"
```

Expected: FAIL because parser packages and extractors do not exist.

- [ ] **Step 3: Add approved parser dependencies**

Add the smallest dependency set that the tests use:

```bash
pnpm --filter @synapse/desktop add mammoth xlsx pdf-parse officeparser
```

If `officeparser` cannot reliably parse the PPTX fixture, replace only that dependency with a focused PPTX parser and document the reason in the commit message.

- [ ] **Step 4: Implement `.xlsx` extractor**

Create `extractors/xlsx.ts`:

```ts
import path from "node:path"
import * as XLSX from "xlsx"
import { markdownTable, normalizeMarkdownTitle } from "../markdown"
import type { FileConversionInput, FileConversionResult, FileExtractor } from "../types"

export class XlsxExtractor implements FileExtractor {
  readonly formats = ["xlsx"] as const

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    const workbook = XLSX.readFile(input.filePath, { cellDates: true })
    const sections: string[] = []
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, blankrows: false })
      sections.push(`## Sheet: ${sheetName}\n`)
      sections.push(markdownTable(rows.slice(0, 201)))
    }
    const title = normalizeMarkdownTitle(path.basename(input.filePath), input.filePath)
    const markdown = [`# ${title}`, "", ...sections].join("\n")
    return {
      sourcePath: input.filePath,
      format: "xlsx",
      kind: "spreadsheet",
      title,
      markdown,
      text: sections.join("\n"),
      metadata: { sheetNames: workbook.SheetNames },
      warnings: [],
    }
  }
}
```

- [ ] **Step 5: Implement `.docx`, `.pdf`, and `.pptx` extractors**

Create `extractors/docx.ts`:

```ts
import path from "node:path"
import mammoth from "mammoth"
import { normalizeMarkdownTitle } from "../markdown"
import { FileConversionError, type FileConversionInput, type FileConversionResult, type FileExtractor } from "../types"

export class DocxExtractor implements FileExtractor {
  readonly formats = ["docx"] as const

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    try {
      const extracted = await mammoth.extractRawText({ path: input.filePath })
      const title = normalizeMarkdownTitle(path.basename(input.filePath), input.filePath)
      const text = extracted.value.trim()
      return {
        sourcePath: input.filePath,
        format: "docx",
        kind: "document",
        title,
        markdown: [`# ${title}`, "", text, ""].join("\n"),
        text,
        metadata: { messages: extracted.messages },
        warnings: extracted.messages.map((message) => ({
          code: message.type,
          message: message.message,
        })),
      }
    } catch (error) {
      throw new FileConversionError("parse_failed", "Could not parse DOCX file.", { cause: error })
    }
  }
}
```

Create `extractors/pdf.ts`:

```ts
import { readFile } from "node:fs/promises"
import path from "node:path"
import pdf from "pdf-parse"
import { normalizeMarkdownTitle } from "../markdown"
import { FileConversionError, type FileConversionInput, type FileConversionResult, type FileExtractor } from "../types"

export class PdfExtractor implements FileExtractor {
  readonly formats = ["pdf"] as const

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    try {
      const data = await pdf(await readFile(input.filePath))
      const title = normalizeMarkdownTitle(data.info?.Title as string | undefined, input.filePath)
      const text = data.text.trim()
      return {
        sourcePath: input.filePath,
        format: "pdf",
        kind: "pdf",
        title,
        markdown: [`# ${title}`, "", text, ""].join("\n"),
        text,
        metadata: {
          pages: data.numpages,
          info: data.info,
        },
        warnings: [],
      }
    } catch (error) {
      throw new FileConversionError("parse_failed", "Could not parse PDF file.", { cause: error })
    }
  }
}
```

Create `extractors/pptx.ts`:

```ts
import path from "node:path"
import officeParser from "officeparser"
import { normalizeMarkdownTitle } from "../markdown"
import { FileConversionError, type FileConversionInput, type FileConversionResult, type FileExtractor } from "../types"

export class PptxExtractor implements FileExtractor {
  readonly formats = ["pptx"] as const

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    try {
      const raw = await officeParser.parseOfficeAsync(input.filePath)
      const text = String(raw).trim()
      const title = normalizeMarkdownTitle(path.basename(input.filePath), input.filePath)
      return {
        sourcePath: input.filePath,
        format: "pptx",
        kind: "presentation",
        title,
        markdown: [`# ${title}`, "", "## Slides", "", text, ""].join("\n"),
        text,
        metadata: {},
        warnings: [{
          code: "presentation_structure_limited",
          message: "Slide boundaries were not fully available from the parser.",
        }],
      }
    } catch (error) {
      throw new FileConversionError("parse_failed", "Could not parse PPTX file.", { cause: error })
    }
  }
}
```

If the selected PPTX parser exposes real slide objects, replace the `## Slides` fallback with `## Slide N` sections and remove the `presentation_structure_limited` warning.

- [ ] **Step 6: Add default service factory**

Update `index.ts`:

```ts
export { DocxExtractor } from "./extractors/docx"
export { LegacyOfficeExtractor } from "./extractors/legacy-office"
export { PdfExtractor } from "./extractors/pdf"
export { PptxExtractor } from "./extractors/pptx"
export { XlsxExtractor } from "./extractors/xlsx"

export function createDefaultFileConversionService(): FileConversionService {
  return new FileConversionService({
    extractors: [
      new DocxExtractor(),
      new XlsxExtractor(),
      new PdfExtractor(),
      new PptxExtractor(),
      new LegacyOfficeExtractor(),
    ],
  })
}
```

- [ ] **Step 7: Run extractor tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-service.test.ts
```

Expected: PASS for modern format tests.

- [ ] **Step 8: Commit**

```bash
git add desktop/package.json pnpm-lock.yaml desktop/electron/services/file-conversion
git commit -m "feat(file-conversion): extract modern document formats"
```

### Task 5: Add Legacy `.doc` And `.ppt` Helper Boundary

**Files:**
- Create: `desktop/electron/services/file-conversion/extractors/legacy-office.ts`
- Test: `desktop/electron/services/file-conversion/__tests__/file-conversion-service.test.ts`

- [ ] **Step 1: Add tests for helper behavior**

Add:

```ts
it("reports missing local helper for legacy Office files", async () => {
  const root = await tempDir()
  const filePath = path.join(root, "legacy.doc")
  await writeFile(filePath, "legacy")
  const { LegacyOfficeExtractor, FileConversionService } = await import("../index")
  const service = new FileConversionService({ extractors: [new LegacyOfficeExtractor({ helperPath: null })] })

  await expect(service.convert({ filePath })).rejects.toMatchObject({ code: "missing_local_helper" })
})
```

Add a stub-helper test that injects a fake runner function:

```ts
it("converts legacy Office files through an injected local helper", async () => {
  const root = await tempDir()
  const filePath = path.join(root, "legacy.ppt")
  await writeFile(filePath, "legacy")
  const { LegacyOfficeExtractor, FileConversionService } = await import("../index")
  const service = new FileConversionService({
    extractors: [new LegacyOfficeExtractor({
      helperPath: "/local/tika-app.jar",
      runHelper: async () => ({ text: "Slide One\nLegacy content", metadata: { parser: "stub" } }),
    })],
  })

  const result = await service.convert({ filePath })

  expect(result.format).toBe("ppt")
  expect(result.kind).toBe("presentation")
  expect(result.markdown).toContain("Legacy content")
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-service.test.ts --testNamePattern "legacy Office"
```

Expected: FAIL because `LegacyOfficeExtractor` is incomplete.

- [ ] **Step 3: Implement legacy boundary**

Create `extractors/legacy-office.ts`:

```ts
import path from "node:path"
import { normalizeMarkdownTitle } from "../markdown"
import { FileConversionError, type FileConversionInput, type FileConversionResult, type FileExtractor } from "../types"

type LegacyHelperOutput = {
  readonly text: string
  readonly metadata: Record<string, unknown>
}

export interface LegacyOfficeExtractorOptions {
  readonly helperPath?: string | null
  readonly runHelper?: (input: { readonly helperPath: string; readonly filePath: string }) => Promise<LegacyHelperOutput>
}

export class LegacyOfficeExtractor implements FileExtractor {
  readonly formats = ["doc", "ppt"] as const
  private readonly helperPath: string | null
  private readonly runHelper: LegacyOfficeExtractorOptions["runHelper"]

  constructor(options: LegacyOfficeExtractorOptions = {}) {
    this.helperPath = options.helperPath ?? process.env.SYNAPSE_TIKA_APP_PATH ?? null
    this.runHelper = options.runHelper
  }

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    const format = path.extname(input.filePath).toLowerCase() === ".ppt" ? "ppt" : "doc"
    if (!this.helperPath || !this.runHelper) {
      throw new FileConversionError("missing_local_helper", `A local helper is required to convert .${format} files.`)
    }
    const output = await this.runHelper({ helperPath: this.helperPath, filePath: input.filePath })
    const title = normalizeMarkdownTitle(path.basename(input.filePath), input.filePath)
    const markdown = [`# ${title}`, "", output.text.trim(), ""].join("\n")
    return {
      sourcePath: input.filePath,
      format,
      kind: format === "ppt" ? "presentation" : "document",
      title,
      markdown,
      text: output.text,
      metadata: output.metadata,
      warnings: [],
    }
  }
}
```

This task intentionally adds the boundary and tests without bundling a Tika jar. Packaging the helper is a separate product/build decision.

- [ ] **Step 4: Run legacy tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-service.test.ts --testNamePattern "legacy Office"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/file-conversion
git commit -m "feat(file-conversion): add legacy office helper boundary"
```

### Task 6: Add Knowledge Base Source Staging

**Files:**
- Create: `desktop/electron/services/knowledge-base/source-staging.ts`
- Modify: `desktop/electron/services/knowledge-base/knowledge-base-service.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/source-staging.test.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`

- [ ] **Step 1: Write staging tests with a fake converter**

Create `desktop/electron/services/knowledge-base/__tests__/source-staging.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { stageKnowledgeBaseSources } from "../source-staging"
import type { FileConversionResult } from "../../file-conversion"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-stage-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("knowledge base source staging", () => {
  it("archives convertible originals and writes generated markdown into raw", async () => {
    const projectPath = await tempDir()
    const inputDir = await tempDir()
    const sourcePath = path.join(inputDir, "report.docx")
    await writeFile(sourcePath, "binary")

    const result = await stageKnowledgeBaseSources({
      projectPath,
      filePaths: [sourcePath],
      now: () => new Date("2026-05-23T13:00:00.000Z"),
      converter: {
        convert: async (): Promise<FileConversionResult> => ({
          sourcePath,
          format: "docx",
          kind: "document",
          title: "report.docx",
          markdown: "# report.docx\n\nBody\n",
          text: "Body",
          metadata: {},
          warnings: [],
        }),
      },
    })

    expect(result.uploaded).toEqual([expect.objectContaining({
      originalPath: sourcePath,
      relativePath: ".raw/documents/2026/05/23/report.md",
      originalRelativePath: "_attachments/originals/2026/05/23/report.docx",
    })])
    await expect(readFile(path.join(projectPath, ".raw", "documents", "2026", "05", "23", "report.md"), "utf8"))
      .resolves.toContain("source_format: \"docx\"")
    await expect(readFile(path.join(projectPath, "_attachments", "originals", "2026", "05", "23", "report.docx"), "utf8"))
      .resolves.toBe("binary")
  })
})
```

- [ ] **Step 2: Run staging test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/source-staging.test.ts
```

Expected: FAIL because `source-staging.ts` does not exist.

- [ ] **Step 3: Implement staging adapter**

Create `desktop/electron/services/knowledge-base/source-staging.ts` with:

- `stageKnowledgeBaseSources(input)`.
- Existing text extension detection copied from current `KnowledgeBaseService` into this file.
- Original archive copy for convertible formats.
- Generated Markdown write using `sourceFrontmatter`.
- Collision-safe naming.
- Structured skipped reasons: `not-file`, `read-error`, `conversion-error`.

Core write behavior:

```ts
const rawKindDir = kind === "document"
  ? "documents"
  : kind === "spreadsheet"
    ? "spreadsheets"
    : kind === "presentation"
      ? "presentations"
      : "pdfs"
```

Generated Markdown file name:

```ts
const markdownName = `${path.parse(sourcePath).name}.md`
```

- [ ] **Step 4: Delegate KnowledgeBaseService uploads**

Modify `KnowledgeBaseService` constructor to accept an optional converter:

```ts
type KnowledgeBaseServiceDeps = {
  templateRoot?: string
  now?: () => Date
  fileConversionService?: Pick<FileConversionService, "convert">
}
```

Replace the body of `uploadSources()` with:

```ts
return stageKnowledgeBaseSources({
  projectPath: payload.projectPath,
  filePaths: payload.filePaths,
  now: this.now,
  converter: this.fileConversionService,
})
```

If no converter is provided, default to `createDefaultFileConversionService()`.

- [ ] **Step 5: Run staging and existing KB service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/knowledge-base/__tests__/source-staging.test.ts \
  electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/knowledge-base desktop/electron/services/file-conversion
git commit -m "feat(kb): stage converted sources as markdown"
```

### Task 7: Update Upload Result Types And IPC Schemas

**Files:**
- Modify: `desktop/src/types/knowledge-base.ts`
- Modify: `desktop/electron/modules/knowledge-base/ipc.ts`
- Test: `desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts`
- Test: `desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx`

- [ ] **Step 1: Extend upload result types**

In `desktop/src/types/knowledge-base.ts`, change uploaded source to:

```ts
export type SynapseKnowledgeBaseUploadedSource = {
  originalPath: string
  relativePath: string
  name: string
  size: number
  originalRelativePath?: string
  conversionWarnings?: Array<{
    code: string
    message: string
  }>
}
```

Change skipped reason:

```ts
reason: "not-file" | "read-error" | "conversion-error"
```

- [ ] **Step 2: Update IPC schemas**

In `desktop/electron/modules/knowledge-base/ipc.ts`, update `uploadSourcesResultSchema` so uploaded items accept optional `originalRelativePath` and `conversionWarnings`, and skipped reasons include `"conversion-error"`.

- [ ] **Step 3: Run IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/knowledge-base/__tests__/ipc.test.ts
```

Expected: PASS after schema updates.

- [ ] **Step 4: Run source manager window tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
```

Expected: PASS. Do not add UI copy beyond existing concise upload result language.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/types/knowledge-base.ts desktop/electron/modules/knowledge-base/ipc.ts desktop/electron/modules/knowledge-base/__tests__/ipc.test.ts desktop/src/modules/knowledge-base/__tests__/source-manager-window.test.tsx
git commit -m "feat(kb): expose converted source upload metadata"
```

### Task 8: Verify Scanning And Boundaries

**Files:**
- Test: `desktop/electron/services/knowledge-base/__tests__/source-scan.test.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`

- [ ] **Step 1: Add a source scan regression**

Add to `source-scan.test.ts`:

```ts
it("treats generated converted markdown as a supported source", async () => {
  const root = await tempDir()
  await mkdir(path.join(root, ".raw", "documents"), { recursive: true })
  await writeFile(path.join(root, ".raw", "documents", "report.md"), "# report\n")
  await writeFile(path.join(root, "_attachments", "originals", "report.docx"), "binary")

  const result = await scanKnowledgeBaseSources(root)

  expect(result.sources).toEqual([expect.objectContaining({
    relativePath: ".raw/documents/report.md",
    state: "new",
  })])
  expect(result.skippedSources).toEqual([])
})
```

- [ ] **Step 2: Add vault cleanliness regression**

In `knowledge-base-service.test.ts`, extend the existing vault cleanliness test:

```ts
await expect(access(path.join(targetPath, "file-conversion"))).rejects.toThrow()
await expect(access(path.join(targetPath, "converter"))).rejects.toThrow()
await expect(access(path.join(targetPath, ".claude-plugin"))).rejects.toThrow()
```

- [ ] **Step 3: Run Knowledge Base tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/knowledge-base/__tests__/source-scan.test.ts \
  electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/services/knowledge-base/__tests__/source-scan.test.ts desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
git commit -m "test(kb): guard converted source boundaries"
```

### Task 9: Final Verification

**Files:**
- No code changes unless verification exposes a real issue.

- [ ] **Step 1: Run focused conversion and KB tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/file-conversion/__tests__/file-conversion-service.test.ts \
  electron/services/file-conversion/__tests__/markdown.test.ts \
  electron/services/knowledge-base/__tests__/source-staging.test.ts \
  electron/services/knowledge-base/__tests__/source-scan.test.ts \
  electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts \
  electron/modules/knowledge-base/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect boundaries**

Run:

```bash
rg -n "file-conversion|FileConversionService|createDefaultFileConversionService" desktop/electron/services/task-scheduler desktop/electron/services/workflow desktop/action-packages || true
find desktop/resources/knowledge-base/templates -maxdepth 6 -type f | rg "(SKILL.md|\\.claude|\\.agents|\\.codex|commands/|hooks/|file-conversion|converter)" || true
```

Expected:

- No Scheduler/Workflow matches unless a future explicit integration is being implemented.
- No output from the template scan.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required fixes:

```bash
git add <fixed-files>
git commit -m "fix(file-conversion): address verification findings"
```

If no fixes were needed, do not create an empty commit.

## Self-Review Checklist

- The common converter has no Knowledge Base dependency.
- Knowledge Base only stages converter output.
- User vault templates remain free of runnable Agent/converter files.
- `.doc` and `.ppt` have a local-helper boundary and explicit `missing_local_helper` failure before packaging a helper.
- Modern `.docx`, `.xlsx`, `.pdf`, and `.pptx` have deterministic local parser tests.
- Future Workflow integration can call `FileConversionService` without importing Knowledge Base code.
