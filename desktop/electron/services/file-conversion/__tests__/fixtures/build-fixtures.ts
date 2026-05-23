import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx"
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
    sections: [
      {
        children: [
          new Paragraph({ text: "Quarterly Review", heading: HeadingLevel.HEADING_1 }),
          new Paragraph("Revenue grew 12 percent."),
          new Paragraph({ children: [new TextRun("Renewal risk in APAC")] }),
        ],
      },
    ],
  })
  await writeFile(filePath, await Packer.toBuffer(doc))
}

async function writeDocxTable(filePath: string): Promise<void> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Budget Table", heading: HeadingLevel.HEADING_1 }),
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
      },
    ],
  })
  await writeFile(filePath, await Packer.toBuffer(doc))
}

function writeXlsxMultiSheet(filePath: string): void {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Department", "Budget", "Date"],
      ["Product", 120000, new Date("2026-05-24T00:00:00.000Z")],
      [],
      ["Engineering", 95000, new Date("2026-06-01T00:00:00.000Z")],
    ]),
    "Summary",
  )
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Owner", "Risk"],
      ["APAC", "Renewal delay"],
    ]),
    "Risks",
  )
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
