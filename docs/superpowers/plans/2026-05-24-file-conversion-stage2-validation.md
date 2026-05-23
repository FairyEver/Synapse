# File Conversion Stage 2 Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the local file conversion service works with real `.docx`, `.xlsx`, `.pdf`, and `.pptx` files, produces useful Markdown for Knowledge Base ingest, and survives Electron build/package verification.

**Architecture:** Keep `desktop/electron/services/file-conversion/` as the common parser service and keep Knowledge Base as a staging consumer. Add real binary fixture generation and fixture tests beside the conversion service, strengthen extractor output and warnings, then record dependency keep/replace decisions after build and packaging checks.

**Tech Stack:** Electron main process, TypeScript, Vitest, Mammoth, SheetJS `xlsx`, `pdf-parse` or direct `pdfjs-dist`, `officeparser` or a replacement PPTX parser, Turndown for DOCX HTML-to-Markdown if needed, small dev-only fixture generators.

---

## File Structure

Create:

- `desktop/electron/services/file-conversion/__tests__/fixtures/README.md` — documents fixture intent and generation method.
- `desktop/electron/services/file-conversion/__tests__/fixtures/build-fixtures.ts` — deterministic fixture builders for tests.
- `desktop/electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts` — real `.docx`, `.xlsx`, `.pdf`, `.pptx` extraction tests.
- `desktop/electron/services/file-conversion/__tests__/file-conversion-errors.test.ts` — malformed, empty extraction, encrypted, size-limit tests.
- `desktop/electron/services/knowledge-base/__tests__/source-staging-fixtures.test.ts` — Knowledge Base staging tests with real fixture files.
- `desktop/electron/services/file-conversion/html-to-markdown.ts` — used only if `.docx` fixture tests prove Mammoth raw text loses required structure.
- `docs/superpowers/reports/2026-05-24-file-conversion-stage2-dependency-decisions.md` — final dependency decision record.

Modify:

- `desktop/electron/services/file-conversion/extractors/docx.ts` — preserve headings, bullets, and tables through HTML-to-Markdown if raw text is insufficient.
- `desktop/electron/services/file-conversion/extractors/xlsx.ts` — add row, column, and sheet limits plus truncation warnings.
- `desktop/electron/services/file-conversion/extractors/pdf.ts` — add page metadata, page sections when available, empty extraction warning, and parse error classification.
- `desktop/electron/services/file-conversion/extractors/pptx.ts` — validate real output, keep or replace parser based on slide boundary quality.
- `desktop/electron/services/file-conversion/types.ts` — add stable warning codes if needed.
- `desktop/package.json` and `pnpm-lock.yaml` — add only the dev/runtime dependencies proven necessary by failing tests.

### Task 1: Add Deterministic Fixture Builders

**Files:**
- Create: `desktop/electron/services/file-conversion/__tests__/fixtures/README.md`
- Create: `desktop/electron/services/file-conversion/__tests__/fixtures/build-fixtures.ts`
- Modify: `desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `desktop/electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts`

- [ ] **Step 1: Write the failing fixture builder test**

Create `desktop/electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { buildFileConversionFixtures } from "./fixtures/build-fixtures"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-conversion-fixtures-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("file conversion fixture builders", () => {
  it("creates real fixture files for each stage 2 format", async () => {
    const root = await tempDir()

    const fixtures = await buildFileConversionFixtures(root)

    expect(fixtures.docxBasic.endsWith("docx/basic.docx")).toBe(true)
    expect(fixtures.docxTable.endsWith("docx/table.docx")).toBe(true)
    expect(fixtures.xlsxMultiSheet.endsWith("xlsx/multi-sheet.xlsx")).toBe(true)
    expect(fixtures.xlsxWideSheet.endsWith("xlsx/wide-sheet.xlsx")).toBe(true)
    expect(fixtures.pdfText.endsWith("pdf/text.pdf")).toBe(true)
    expect(fixtures.pptxBasic.endsWith("pptx/basic.pptx")).toBe(true)
    expect(fixtures.malformedDocx.endsWith("malformed/broken.docx")).toBe(true)
    expect(fixtures.malformedPdf.endsWith("malformed/broken.pdf")).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts --testNamePattern "creates real fixture files"
```

Expected: FAIL because `./fixtures/build-fixtures` does not exist.

- [ ] **Step 3: Add fixture generation dependencies**

Add dev-only generators:

```bash
pnpm --filter @synapse/desktop add -D docx pdfkit pptxgenjs @types/pdfkit
```

Do not use these libraries in production extractors.

- [ ] **Step 4: Add fixture README**

Create `desktop/electron/services/file-conversion/__tests__/fixtures/README.md`:

```md
# File Conversion Fixtures

Stage 2 tests generate small synthetic binary files at runtime instead of storing user-like documents in the repository.

The generator lives in `build-fixtures.ts` and creates:

- DOCX files with headings, paragraphs, bullets, and a table.
- XLSX files with multiple sheets and wide-table data.
- A text PDF with two pages.
- A PPTX deck with two slides.
- Malformed files with Office/PDF extensions.

These fixtures are synthetic and contain no user data.
The generator dependencies are dev-only and must not be imported by production extractors.
```

- [ ] **Step 5: Implement fixture builders**

Create `desktop/electron/services/file-conversion/__tests__/fixtures/build-fixtures.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx"
import PDFDocument from "pdfkit"
import pptxgen from "pptxgenjs"
import * as XLSX from "xlsx"

export interface FileConversionFixturePaths {
  readonly docxBasic: string
  readonly docxTable: string
  readonly xlsxMultiSheet: string
  readonly xlsxWideSheet: string
  readonly pdfText: string
  readonly pptxBasic: string
  readonly malformedDocx: string
  readonly malformedPdf: string
}

export async function buildFileConversionFixtures(root: string): Promise<FileConversionFixturePaths> {
  const docxDir = path.join(root, "docx")
  const xlsxDir = path.join(root, "xlsx")
  const pdfDir = path.join(root, "pdf")
  const pptxDir = path.join(root, "pptx")
  const malformedDir = path.join(root, "malformed")
  await Promise.all([docxDir, xlsxDir, pdfDir, pptxDir, malformedDir].map((dir) => mkdir(dir, { recursive: true })))

  const paths: FileConversionFixturePaths = {
    docxBasic: path.join(docxDir, "basic.docx"),
    docxTable: path.join(docxDir, "table.docx"),
    xlsxMultiSheet: path.join(xlsxDir, "multi-sheet.xlsx"),
    xlsxWideSheet: path.join(xlsxDir, "wide-sheet.xlsx"),
    pdfText: path.join(pdfDir, "text.pdf"),
    pptxBasic: path.join(pptxDir, "basic.pptx"),
    malformedDocx: path.join(malformedDir, "broken.docx"),
    malformedPdf: path.join(malformedDir, "broken.pdf"),
  }

  await Promise.all([
    writeDocxBasic(paths.docxBasic),
    writeDocxTable(paths.docxTable),
    writeXlsxMultiSheet(paths.xlsxMultiSheet),
    writeXlsxWideSheet(paths.xlsxWideSheet),
    writePdfText(paths.pdfText),
    writePptxBasic(paths.pptxBasic),
    writeFile(paths.malformedDocx, "not a real docx", "utf8"),
    writeFile(paths.malformedPdf, "not a real pdf", "utf8"),
  ])

  return paths
}

async function writeDocxBasic(filePath: string): Promise<void> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: "Quarterly Review", heading: "Heading1" }),
        new Paragraph("Revenue grew 12 percent."),
        new Paragraph({ children: [new TextRun("Renewal risk in APAC")] }),
      ],
    }],
  })
  await writeFile(filePath, await Packer.toBuffer(doc))
}

async function writeDocxTable(filePath: string): Promise<void> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: "Budget Table", heading: "Heading1" }),
        new Table({
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("Department")] }),
                new TableCell({ children: [new Paragraph("Budget")] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("Product")] }),
                new TableCell({ children: [new Paragraph("120000")] }),
              ],
            }),
          ],
        }),
      ],
    }],
  })
  await writeFile(filePath, await Packer.toBuffer(doc))
}

function writeXlsxMultiSheet(filePath: string): void {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Department", "Budget", "Date"],
    ["Product", 120000, new Date("2026-05-24T00:00:00.000Z")],
    [],
    ["Engineering", 95000, new Date("2026-06-01T00:00:00.000Z")],
  ]), "Summary")
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Owner", "Risk"],
    ["APAC", "Renewal delay"],
  ]), "Risks")
  XLSX.writeFile(workbook, filePath)
}

function writeXlsxWideSheet(filePath: string): void {
  const workbook = XLSX.utils.book_new()
  const header = Array.from({ length: 35 }, (_, index) => `Column ${index + 1}`)
  const row = Array.from({ length: 35 }, (_, index) => `Value ${index + 1}`)
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, row]), "Wide")
  XLSX.writeFile(workbook, filePath)
}

async function writePdfText(filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument()
    const chunks: Buffer[] = []
    doc.on("data", (chunk: Buffer) => chunks.push(chunk))
    doc.on("error", reject)
    doc.on("end", () => {
      writeFile(filePath, Buffer.concat(chunks)).then(resolve, reject)
    })
    doc.text("Quarterly Review PDF")
    doc.text("Page one revenue grew 12 percent.")
    doc.addPage()
    doc.text("Page two renewal risk in APAC.")
    doc.end()
  })
}

async function writePptxBasic(filePath: string): Promise<void> {
  const pptx = new pptxgen()
  pptx.layout = "LAYOUT_WIDE"
  const first = pptx.addSlide()
  first.addText("Quarterly Review", { x: 0.5, y: 0.5, w: 8, h: 0.6 })
  first.addText("Revenue grew 12 percent.", { x: 0.5, y: 1.4, w: 8, h: 0.6 })
  const second = pptx.addSlide()
  second.addText("Risks", { x: 0.5, y: 0.5, w: 8, h: 0.6 })
  second.addText("Renewal delay in APAC.", { x: 0.5, y: 1.4, w: 8, h: 0.6 })
  await pptx.writeFile({ fileName: filePath })
}
```

- [ ] **Step 6: Run the fixture builder test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts --testNamePattern "creates real fixture files"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/package.json pnpm-lock.yaml desktop/electron/services/file-conversion/__tests__/fixtures desktop/electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts
git commit -m "test(file-conversion): add stage two fixture builders"
```

### Task 2: Validate DOCX Real Extraction Quality

**Files:**
- Modify: `desktop/electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts`
- Create: `desktop/electron/services/file-conversion/html-to-markdown.ts`
- Modify: `desktop/electron/services/file-conversion/extractors/docx.ts`
- Modify: `desktop/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add failing DOCX structure tests**

Append to `file-conversion-fixtures.test.ts`:

```ts
import { createDefaultFileConversionService } from "../index"

describe("file conversion real DOCX fixtures", () => {
  it("preserves docx headings and paragraphs as markdown", async () => {
    const root = await tempDir()
    const fixtures = await buildFileConversionFixtures(root)

    const result = await createDefaultFileConversionService().convert({ filePath: fixtures.docxBasic })

    expect(result.format).toBe("docx")
    expect(result.kind).toBe("document")
    expect(result.text).toContain("Quarterly Review")
    expect(result.text).toContain("Revenue grew 12 percent.")
    expect(result.markdown).toContain("# Quarterly Review")
  })

  it("preserves docx table content in markdown", async () => {
    const root = await tempDir()
    const fixtures = await buildFileConversionFixtures(root)

    const result = await createDefaultFileConversionService().convert({ filePath: fixtures.docxTable })

    expect(result.markdown).toContain("Budget Table")
    expect(result.markdown).toContain("Department")
    expect(result.markdown).toContain("Product")
    expect(result.markdown).toContain("120000")
  })
})
```

- [ ] **Step 2: Run DOCX tests and verify failure if raw text is insufficient**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts --testNamePattern "DOCX"
```

Expected: At least the heading Markdown assertion may FAIL with the Stage 1 raw-text extractor.

- [ ] **Step 3: Add HTML-to-Markdown dependencies if needed**

If the DOCX tests fail because heading/table structure is missing, install:

```bash
pnpm --filter @synapse/desktop add turndown turndown-plugin-gfm
pnpm --filter @synapse/desktop add -D @types/turndown
```

Skip this step only if Stage 1 output already satisfies the DOCX tests.

- [ ] **Step 4: Add `html-to-markdown.ts`**

Create `desktop/electron/services/file-conversion/html-to-markdown.ts`:

```ts
import TurndownService from "turndown"
import { gfm } from "turndown-plugin-gfm"

export function htmlToMarkdown(html: string): string {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  })
  service.use(gfm)
  return service.turndown(html).trim()
}
```

- [ ] **Step 5: Update `DocxExtractor` to use Mammoth HTML**

In `desktop/electron/services/file-conversion/extractors/docx.ts`, replace the raw text parser type with HTML conversion:

```ts
import { htmlToMarkdown } from "../html-to-markdown"

type MammothHtmlResult = {
  readonly value: string
  readonly messages: readonly MammothMessage[]
}

type ConvertToHtml = (input: { readonly path: string }) => Promise<MammothHtmlResult>

type MammothModule = {
  readonly convertToHtml: ConvertToHtml
}

export interface DocxExtractorOptions {
  readonly convertToHtml?: ConvertToHtml
}
```

Then in the class:

```ts
private readonly convertToHtml: ConvertToHtml

constructor(options: DocxExtractorOptions = {}) {
  const mammoth = require("mammoth") as MammothModule
  this.convertToHtml = options.convertToHtml ?? mammoth.convertToHtml
}
```

And in `extract()`:

```ts
const extracted = await this.convertToHtml({ path: input.filePath })
const markdownBody = htmlToMarkdown(extracted.value)
const title = extractFirstMarkdownHeading(markdownBody) ?? normalizeMarkdownTitle(path.basename(input.filePath), input.filePath)
const markdown = markdownBody.startsWith("# ")
  ? `${markdownBody}\n`
  : [`# ${title}`, "", markdownBody, ""].join("\n")
const text = markdownBody.replace(/^#{1,6}\s+/gm, "").replace(/\|/g, " ").trim()
```

Add this helper in the same file:

```ts
function extractFirstMarkdownHeading(markdown: string): string | null {
  const match = /^#\s+(.+)$/m.exec(markdown)
  return match?.[1]?.trim() || null
}
```

- [ ] **Step 6: Update existing mock DOCX test**

In `file-conversion-service.test.ts`, update the mock constructor usage:

```ts
new DocxExtractor({
  convertToHtml: async () => ({
    value: "<h1>Quarterly Report</h1><p>Revenue grew 12%.</p>",
    messages: [{ type: "warning", message: "Ignored style" }],
  }),
})
```

Expected assertions:

```ts
expect(result.markdown).toContain("# Quarterly Report")
expect(result.text).toContain("Revenue grew 12%.")
```

- [ ] **Step 7: Run DOCX tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/file-conversion/__tests__/file-conversion-service.test.ts \
  electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts \
  --testNamePattern "DOCX|docx"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/package.json pnpm-lock.yaml desktop/electron/services/file-conversion
git commit -m "feat(file-conversion): validate docx structure extraction"
```

### Task 3: Add XLSX Limits And Truncation Warnings

**Files:**
- Modify: `desktop/electron/services/file-conversion/extractors/xlsx.ts`
- Modify: `desktop/electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts`
- Modify: `desktop/electron/services/file-conversion/__tests__/file-conversion-service.test.ts`

- [ ] **Step 1: Add failing XLSX fixture tests**

Append to `file-conversion-fixtures.test.ts`:

```ts
describe("file conversion real XLSX fixtures", () => {
  it("renders each xlsx sheet as a markdown section", async () => {
    const root = await tempDir()
    const fixtures = await buildFileConversionFixtures(root)

    const result = await createDefaultFileConversionService().convert({ filePath: fixtures.xlsxMultiSheet })

    expect(result.format).toBe("xlsx")
    expect(result.kind).toBe("spreadsheet")
    expect(result.markdown).toContain("## Sheet: Summary")
    expect(result.markdown).toContain("## Sheet: Risks")
    expect(result.markdown).toContain("| Department | Budget | Date |")
    expect(result.markdown).toContain("| APAC | Renewal delay |")
  })

  it("truncates wide xlsx sheets with a warning", async () => {
    const root = await tempDir()
    const fixtures = await buildFileConversionFixtures(root)

    const result = await createDefaultFileConversionService().convert({ filePath: fixtures.xlsxWideSheet })

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "xlsx_truncated" }),
    ]))
    expect(result.markdown).toContain("Column 30")
    expect(result.markdown).not.toContain("Column 31")
  })
})
```

- [ ] **Step 2: Run XLSX tests and verify truncation failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts --testNamePattern "XLSX|xlsx"
```

Expected: FAIL on the truncation warning and `Column 31` assertion.

- [ ] **Step 3: Update `XlsxExtractor` with limits**

In `desktop/electron/services/file-conversion/extractors/xlsx.ts`, add:

```ts
export interface XlsxExtractorOptions {
  readonly maxSheets?: number
  readonly maxRowsPerSheet?: number
  readonly maxColumnsPerSheet?: number
}
```

Add constructor:

```ts
private readonly maxSheets: number
private readonly maxRowsPerSheet: number
private readonly maxColumnsPerSheet: number

constructor(options: XlsxExtractorOptions = {}) {
  this.maxSheets = options.maxSheets ?? 20
  this.maxRowsPerSheet = options.maxRowsPerSheet ?? 200
  this.maxColumnsPerSheet = options.maxColumnsPerSheet ?? 30
}
```

Inside `extract()`:

```ts
const warnings: FileConversionResult["warnings"] = []
const sheetNames = workbook.SheetNames.slice(0, this.maxSheets)
if (workbook.SheetNames.length > this.maxSheets) {
  warnings.push({
    code: "xlsx_truncated",
    message: `Rendered ${this.maxSheets} of ${workbook.SheetNames.length} sheets.`,
  })
}
```

When preparing rows:

```ts
const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, blankrows: false })
const rows = rawRows
  .slice(0, this.maxRowsPerSheet + 1)
  .map((row) => row.slice(0, this.maxColumnsPerSheet))
if (rawRows.length > this.maxRowsPerSheet + 1 || rawRows.some((row) => row.length > this.maxColumnsPerSheet)) {
  warnings.push({
    code: "xlsx_truncated",
    message: `Sheet "${sheetName}" exceeded ${this.maxRowsPerSheet} rows or ${this.maxColumnsPerSheet} columns.`,
  })
}
```

Return `warnings`.

- [ ] **Step 4: Export options type**

In `index.ts`, change:

```ts
export { XlsxExtractor, type XlsxExtractorOptions } from "./extractors/xlsx"
```

- [ ] **Step 5: Run XLSX tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/file-conversion/__tests__/file-conversion-service.test.ts \
  electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts \
  --testNamePattern "XLSX|xlsx"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/file-conversion
git commit -m "feat(file-conversion): add xlsx rendering limits"
```

### Task 4: Strengthen PDF Extraction And Empty Warnings

**Files:**
- Modify: `desktop/electron/services/file-conversion/extractors/pdf.ts`
- Modify: `desktop/electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts`
- Test: `desktop/electron/services/file-conversion/__tests__/file-conversion-errors.test.ts`

- [ ] **Step 1: Add failing PDF fixture test**

Append to `file-conversion-fixtures.test.ts`:

```ts
describe("file conversion real PDF fixtures", () => {
  it("extracts text and page metadata from real text pdfs", async () => {
    const root = await tempDir()
    const fixtures = await buildFileConversionFixtures(root)

    const result = await createDefaultFileConversionService().convert({ filePath: fixtures.pdfText })

    expect(result.format).toBe("pdf")
    expect(result.kind).toBe("pdf")
    expect(result.text).toContain("Quarterly Review PDF")
    expect(result.text).toContain("Page two renewal risk in APAC.")
    expect(result.metadata.pages).toBeGreaterThanOrEqual(2)
    expect(result.markdown).toContain("# text.pdf")
  })
})
```

- [ ] **Step 2: Add failing empty PDF parser test**

Create `desktop/electron/services/file-conversion/__tests__/file-conversion-errors.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { FileConversionService, PdfExtractor } from "../index"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-conversion-errors-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("file conversion structured errors and warnings", () => {
  it("reports empty pdf extraction as a warning", async () => {
    const root = await tempDir()
    const filePath = path.join(root, "empty.pdf")
    await writeFile(filePath, "%PDF-1.7\n")
    const service = new FileConversionService({
      extractors: [new PdfExtractor({
        parsePdf: async () => ({ text: "", total: 1, info: {} }),
      })],
    })

    const result = await service.convert({ filePath })

    expect(result.warnings).toEqual([{
      code: "empty_extraction",
      message: "PDF parser returned no text.",
    }])
  })
})
```

- [ ] **Step 3: Run PDF tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts \
  electron/services/file-conversion/__tests__/file-conversion-errors.test.ts \
  --testNamePattern "PDF|pdf"
```

Expected: FAIL if `empty_extraction` warning is missing.

- [ ] **Step 4: Add empty extraction warning**

In `pdf.ts`, after trimming text:

```ts
const warnings: FileConversionResult["warnings"] = []
if (text.length === 0) {
  warnings.push({
    code: "empty_extraction",
    message: "PDF parser returned no text.",
  })
}
```

Return `warnings`.

- [ ] **Step 5: Preserve pages metadata**

Ensure returned metadata keeps the page count:

```ts
metadata: {
  pages: data.numpages ?? data.total,
  info: data.info ?? {},
},
```

- [ ] **Step 6: Run PDF tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts \
  electron/services/file-conversion/__tests__/file-conversion-errors.test.ts \
  --testNamePattern "PDF|pdf"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/file-conversion
git commit -m "feat(file-conversion): validate pdf text extraction"
```

### Task 5: Validate PPTX Quality And Decide Parser Fate

**Files:**
- Modify: `desktop/electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts`
- Modify: `desktop/electron/services/file-conversion/extractors/pptx.ts`
- Create: `docs/superpowers/reports/2026-05-24-file-conversion-stage2-dependency-decisions.md`

- [ ] **Step 1: Add PPTX fixture test**

Append to `file-conversion-fixtures.test.ts`:

```ts
describe("file conversion real PPTX fixtures", () => {
  it("extracts real pptx slide text", async () => {
    const root = await tempDir()
    const fixtures = await buildFileConversionFixtures(root)

    const result = await createDefaultFileConversionService().convert({ filePath: fixtures.pptxBasic })

    expect(result.format).toBe("pptx")
    expect(result.kind).toBe("presentation")
    expect(result.text).toContain("Quarterly Review")
    expect(result.text).toContain("Revenue grew 12 percent.")
    expect(result.text).toContain("Risks")
    expect(result.text).toContain("Renewal delay in APAC.")
    expect(result.markdown).toContain("# basic.pptx")
  })
})
```

- [ ] **Step 2: Run PPTX test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts --testNamePattern "PPTX|pptx"
```

Expected: PASS if `officeparser` extracts text. If it fails or produces unusable output, stop and mark `officeparser` as replace in the dependency decision report.

- [ ] **Step 3: Normalize PPTX empty output**

If `officeparser` returns an object string such as `[object Object]`, update `defaultParseOffice()` in `pptx.ts`:

```ts
async function defaultParseOffice(filePath: string): Promise<string> {
  const parsed = await OfficeParser.parseOffice(filePath, { ocr: false })
  if (typeof parsed === "object" && parsed !== null && "toText" in parsed && typeof parsed.toText === "function") {
    return String(parsed.toText())
  }
  if (typeof parsed === "object" && parsed !== null && "content" in parsed) {
    return flattenOfficeNodes((parsed as { readonly content?: unknown }).content).join("\n")
  }
  return String(parsed)
}

function flattenOfficeNodes(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap((item) => flattenOfficeNodes(item))
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    return [
      ...flattenOfficeNodes(record.text),
      ...flattenOfficeNodes(record.value),
      ...flattenOfficeNodes(record.children),
      ...flattenOfficeNodes(record.content),
    ]
  }
  return []
}
```

- [ ] **Step 4: Create initial dependency decision report**

Create `docs/superpowers/reports/2026-05-24-file-conversion-stage2-dependency-decisions.md`:

```md
# File Conversion Stage 2 Dependency Decisions

Date: 2026-05-24

| Dependency | Decision | Reason |
| --- | --- | --- |
| mammoth | Pending final build/package verification | DOCX fixture tests determine structure quality. |
| xlsx | Pending final build/package verification | XLSX fixture tests determine table and truncation quality. |
| pdf-parse | Pending package verification | Native dependency risk must be resolved. |
| officeparser | Pending PPTX fixture quality and package verification | PPTX text quality and slide boundary behavior must be resolved. |

## Verification Notes

- Fixture tests: not run yet in this report.
- Typecheck: not run yet in this report.
- Electron build: not run yet in this report.
- Packaging: not run yet in this report.
```

- [ ] **Step 5: Update report with PPTX result**

After the PPTX test, edit the `officeparser` row:

```md
| officeparser | Keep pending package verification | Real PPTX fixture extracted title and body text; slide boundaries remain limited, so `presentation_structure_limited` stays in warnings. |
```

If the test failed, use:

```md
| officeparser | Replace | Real PPTX fixture did not extract useful title/body text. Stage 2 should stop before packaging verification and choose a focused PPTX parser. |
```

- [ ] **Step 6: Run PPTX test again**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts --testNamePattern "PPTX|pptx"
```

Expected: PASS only if report says keep or keep pending package verification. If report says replace, stop execution and ask for parser replacement approval.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/file-conversion docs/superpowers/reports/2026-05-24-file-conversion-stage2-dependency-decisions.md
git commit -m "test(file-conversion): validate pptx extraction quality"
```

### Task 6: Add Malformed, Encrypted, And Size-Limit Coverage

**Files:**
- Modify: `desktop/electron/services/file-conversion/__tests__/file-conversion-errors.test.ts`
- Modify: `desktop/electron/services/file-conversion/service.ts`
- Modify: `desktop/electron/services/file-conversion/extractors/docx.ts`
- Modify: `desktop/electron/services/file-conversion/extractors/pdf.ts`
- Modify: `desktop/electron/services/file-conversion/extractors/pptx.ts`

- [ ] **Step 1: Add malformed and size-limit tests**

Append to `file-conversion-errors.test.ts`:

```ts
import { buildFileConversionFixtures } from "./fixtures/build-fixtures"
import { createDefaultFileConversionService, DocxExtractor, FileConversionService, PdfExtractor } from "../index"

it("returns parse_failed for malformed docx files", async () => {
  const root = await tempDir()
  const fixtures = await buildFileConversionFixtures(root)

  await expect(createDefaultFileConversionService().convert({ filePath: fixtures.malformedDocx }))
    .rejects.toMatchObject({ code: "parse_failed" })
})

it("returns parse_failed for malformed pdf files", async () => {
  const root = await tempDir()
  const fixtures = await buildFileConversionFixtures(root)

  await expect(createDefaultFileConversionService().convert({ filePath: fixtures.malformedPdf }))
    .rejects.toMatchObject({ code: "parse_failed" })
})

it("returns size_limit_exceeded before parsing oversized files", async () => {
  const root = await tempDir()
  const filePath = path.join(root, "large.docx")
  await writeFile(filePath, "1234567890")
  const service = new FileConversionService({ extractors: [new DocxExtractor()], maxBytes: 5 })

  await expect(service.convert({ filePath })).rejects.toMatchObject({ code: "size_limit_exceeded" })
})

it("maps detectable encrypted parser errors to encrypted", async () => {
  const root = await tempDir()
  const filePath = path.join(root, "locked.pdf")
  await writeFile(filePath, "%PDF-1.7\n")
  const service = new FileConversionService({
    extractors: [new PdfExtractor({
      parsePdf: async () => {
        throw new Error("Password required to open encrypted PDF")
      },
    })],
  })

  await expect(service.convert({ filePath })).rejects.toMatchObject({ code: "encrypted" })
})
```

- [ ] **Step 2: Run error tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-errors.test.ts
```

Expected: FAIL if encrypted errors still map to `parse_failed`.

- [ ] **Step 3: Add parser error classifier**

Create helper inside `types.ts` or a new `errors.ts`. Prefer `errors.ts` if more than one extractor uses it.

Create `desktop/electron/services/file-conversion/errors.ts`:

```ts
import { FileConversionError } from "./types"

export function parserError(codeContext: "docx" | "pdf" | "pptx" | "xlsx", error: unknown): FileConversionError {
  const message = error instanceof Error ? error.message : String(error)
  if (/password|encrypted|decrypt/i.test(message)) {
    return new FileConversionError("encrypted", `Could not parse encrypted ${codeContext.toUpperCase()} file.`, { cause: error })
  }
  return new FileConversionError("parse_failed", `Could not parse ${codeContext.toUpperCase()} file.`, { cause: error })
}
```

- [ ] **Step 4: Use classifier in extractors**

In `docx.ts`, `pdf.ts`, and `pptx.ts`, replace catch blocks:

```ts
} catch (error) {
  throw parserError("pdf", error)
}
```

Use `"docx"` in `docx.ts`, `"pptx"` in `pptx.ts`, and `"pdf"` in `pdf.ts`.

- [ ] **Step 5: Run error tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/file-conversion/__tests__/file-conversion-errors.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/file-conversion
git commit -m "feat(file-conversion): classify parser failures"
```

### Task 7: Knowledge Base Fixture End-To-End Tests

**Files:**
- Create: `desktop/electron/services/knowledge-base/__tests__/source-staging-fixtures.test.ts`

- [ ] **Step 1: Write Knowledge Base fixture staging tests**

Create `desktop/electron/services/knowledge-base/__tests__/source-staging-fixtures.test.ts`:

```ts
import { access, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { buildFileConversionFixtures } from "../../file-conversion/__tests__/fixtures/build-fixtures"
import { KnowledgeBaseService } from "../knowledge-base-service"
import { scanKnowledgeBaseSources } from "../source-scan"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-fixture-stage-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("knowledge base staging with real converted fixtures", () => {
  it.each([
    ["docx", "docxBasic", ".raw/documents/2026/05/24/basic.md", "_attachments/originals/2026/05/24/basic.docx"],
    ["xlsx", "xlsxMultiSheet", ".raw/spreadsheets/2026/05/24/multi-sheet.md", "_attachments/originals/2026/05/24/multi-sheet.xlsx"],
    ["pdf", "pdfText", ".raw/pdfs/2026/05/24/text.md", "_attachments/originals/2026/05/24/text.pdf"],
    ["pptx", "pptxBasic", ".raw/presentations/2026/05/24/basic.md", "_attachments/originals/2026/05/24/basic.pptx"],
  ] as const)("stages %s originals and generated markdown", async (_format, fixtureKey, rawPath, originalPath) => {
    const projectPath = await tempDir()
    const fixtureRoot = await tempDir()
    const fixtures = await buildFileConversionFixtures(fixtureRoot)
    const service = new KnowledgeBaseService({ now: () => new Date("2026-05-24T08:00:00.000Z") })

    const result = await service.uploadSources({ projectPath, filePaths: [fixtures[fixtureKey]] })

    expect(result.skipped).toEqual([])
    expect(result.uploaded).toEqual([expect.objectContaining({
      relativePath: rawPath,
      originalRelativePath: originalPath,
    })])
    await expect(access(path.join(projectPath, rawPath))).resolves.toBeUndefined()
    await expect(access(path.join(projectPath, originalPath))).resolves.toBeUndefined()

    const scan = await scanKnowledgeBaseSources(projectPath)
    expect(scan.sources).toEqual([expect.objectContaining({
      relativePath: rawPath,
      state: "new",
    })])
    expect(scan.skippedSources).toEqual([])
  })
})
```

- [ ] **Step 2: Run Knowledge Base fixture tests and verify failure or pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/source-staging-fixtures.test.ts
```

Expected: PASS if Tasks 2-5 are complete. If a format fails, fix that format extractor before proceeding.

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/services/knowledge-base/__tests__/source-staging-fixtures.test.ts
git commit -m "test(kb): stage real converted fixtures"
```

### Task 8: Build And Packaging Verification

**Files:**
- Modify: `docs/superpowers/reports/2026-05-24-file-conversion-stage2-dependency-decisions.md`
- Modify: `desktop/package.json` if dependency replacement or `asarUnpack` changes are required.

- [ ] **Step 1: Run focused fixture and regression tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/file-conversion/__tests__/file-conversion-service.test.ts \
  electron/services/file-conversion/__tests__/markdown.test.ts \
  electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts \
  electron/services/file-conversion/__tests__/file-conversion-errors.test.ts \
  electron/services/knowledge-base/__tests__/source-staging.test.ts \
  electron/services/knowledge-base/__tests__/source-staging-fixtures.test.ts \
  electron/services/knowledge-base/__tests__/source-scan.test.ts \
  electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts \
  electron/modules/knowledge-base/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run Electron build**

Run:

```bash
pnpm --filter @synapse/desktop run build:electron
```

Expected: PASS.

- [ ] **Step 4: Run renderer build**

Run:

```bash
pnpm --filter @synapse/desktop run build:renderer
```

Expected: PASS.

- [ ] **Step 5: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 6: Run packaging directory build**

Run:

```bash
pnpm --filter @synapse/desktop exec electron-builder --dir --mac --arm64 --publish never
```

Expected: PASS, or FAIL with a parser/native dependency packaging issue that is recorded in the dependency decision report.

- [ ] **Step 7: Inspect native dependency risk**

Run:

```bash
pnpm --filter @synapse/desktop why pdf-parse
pnpm --filter @synapse/desktop why @napi-rs/canvas
find desktop/node_modules -path '*@napi-rs*' -maxdepth 5 -type f | head -40
```

Expected: The report records whether `@napi-rs/canvas` is present and whether packaging includes it safely.

- [ ] **Step 8: Update dependency decisions report**

Replace the report table with final decisions:

```md
| Dependency | Decision | Reason |
| --- | --- | --- |
| mammoth | Keep | DOCX fixtures preserve headings and table text after HTML-to-Markdown normalization; build checks pass. |
| xlsx | Keep | XLSX fixtures preserve multi-sheet tables and truncation warnings; build checks pass. |
| pdf-parse | Keep | Text PDF fixtures pass and packaging handles native dependencies. |
| officeparser | Keep with limitation | PPTX fixtures extract useful title/body text; slide boundaries remain limited and are represented by `presentation_structure_limited`. |
```

If `pdf-parse` packaging fails, use:

```md
| pdf-parse | Replace | Packaging failed because native dependency handling is not acceptable. Replace with direct `pdfjs-dist` extraction before release. |
```

If `officeparser` quality fails, use:

```md
| officeparser | Replace | Real PPTX fixture did not extract useful text or produced unstable output. Replace with a focused PPTX parser before release. |
```

Add a `Verification Commands` section listing each command and pass/fail result.

- [ ] **Step 9: Commit verification report and packaging changes**

If only the report changed:

```bash
git add docs/superpowers/reports/2026-05-24-file-conversion-stage2-dependency-decisions.md
git commit -m "docs(file-conversion): record stage two dependency decisions"
```

If package config changed:

```bash
git add desktop/package.json pnpm-lock.yaml docs/superpowers/reports/2026-05-24-file-conversion-stage2-dependency-decisions.md
git commit -m "fix(file-conversion): address parser packaging risk"
```

### Task 9: Final Boundary Verification

**Files:**
- No planned code changes.

- [ ] **Step 1: Verify Knowledge Base template cleanliness**

Run:

```bash
find desktop/resources/knowledge-base/templates -maxdepth 6 -type f | rg "(SKILL.md|\\.claude|\\.agents|\\.codex|commands/|hooks/|file-conversion|converter)" || true
```

Expected: no output.

- [ ] **Step 2: Verify Workflow and Scheduler are not coupled to Knowledge Base conversion staging**

Run:

```bash
rg -n "source-staging|KnowledgeBaseService|knowledge-base" desktop/electron/services/workflow desktop/electron/services/task-scheduler desktop/action-packages || true
```

Expected: no new matches caused by Stage 2.

- [ ] **Step 3: Verify common converter remains Knowledge Base independent**

Run:

```bash
rg -n "knowledge-base|KnowledgeBase|\\.raw|wiki/|manifest" desktop/electron/services/file-conversion || true
```

Expected: no matches except test names or comments that explicitly verify consumer behavior. Production files under `file-conversion/` must not import Knowledge Base modules or mention `.raw`.

- [ ] **Step 4: Run diff check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Run final focused verification**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/file-conversion/__tests__/file-conversion-service.test.ts \
  electron/services/file-conversion/__tests__/markdown.test.ts \
  electron/services/file-conversion/__tests__/file-conversion-fixtures.test.ts \
  electron/services/file-conversion/__tests__/file-conversion-errors.test.ts \
  electron/services/knowledge-base/__tests__/source-staging.test.ts \
  electron/services/knowledge-base/__tests__/source-staging-fixtures.test.ts \
  electron/services/knowledge-base/__tests__/source-scan.test.ts \
  electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts \
  electron/modules/knowledge-base/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: all commands PASS.

- [ ] **Step 6: Commit boundary fixes if needed**

If a boundary scan or final verification required a fix:

```bash
git add desktop/electron/services/file-conversion \
  desktop/electron/services/knowledge-base \
  desktop/electron/modules/knowledge-base \
  desktop/src/types/knowledge-base.ts \
  desktop/package.json \
  pnpm-lock.yaml \
  docs/superpowers/reports/2026-05-24-file-conversion-stage2-dependency-decisions.md
git commit -m "fix(file-conversion): complete stage two verification"
```

If no fixes were needed, do not create an empty commit.

## Self-Review Checklist

- Every Stage 2 spec requirement maps to a task:
  - Fixture corpus: Task 1.
  - DOCX real extraction: Task 2.
  - XLSX truncation and warnings: Task 3.
  - PDF text and empty warning: Task 4.
  - PPTX quality and parser decision: Task 5.
  - Error model: Task 6.
  - Knowledge Base end-to-end staging: Task 7.
  - Build/package verification: Task 8.
  - Boundary checks: Task 9.
- No parser code is placed inside a user Knowledge Base template.
- No Workflow or Scheduler integration is added in Stage 2.
- The dependency decision report must be updated with real command results before claiming Stage 2 complete.
