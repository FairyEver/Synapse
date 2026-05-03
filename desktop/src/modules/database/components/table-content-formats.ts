import type { Column } from "@/types/database"

type TableContentColumn = Pick<Column, "name" | "kind">

type TableContentFormat = "csv" | "markdown"
type TableDownloadFormat = "csv" | "xlsx"

type TableContentData = {
  tableName: string
  columns: TableContentColumn[]
  rows: Record<string, unknown>[]
}

const textEncoder = new TextEncoder()
const crcTable = buildCrcTable()

function formatTableContent(data: TableContentData, format: TableContentFormat): string {
  return format === "csv" ? generateCsv(data) : generateMarkdownTable(data)
}

function downloadTableContent(data: TableContentData, format: TableDownloadFormat): void {
  const safeName = sanitizeFileName(data.tableName)
  const fileName = `${safeName}.${format}`
  const blob = format === "csv"
    ? new Blob([generateCsv(data)], { type: "text/csv;charset=utf-8" })
    : createXlsxBlob(data)

  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function generateCsv({ columns, rows }: TableContentData): string {
  const lines = [columns.map((column) => escapeCsvValue(column.name)).join(",")]
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvValue(normalizeCellValue(row[column.name]))).join(","))
  }
  return lines.join("\n")
}

function generateMarkdownTable({ columns, rows }: TableContentData): string {
  const header = `| ${columns.map((column) => escapeMarkdownCell(column.name)).join(" | ")} |`
  const separator = `| ${columns.map(() => "---").join(" | ")} |`
  const body = rows.map((row) => (
    `| ${columns.map((column) => escapeMarkdownCell(normalizeCellValue(row[column.name]))).join(" | ")} |`
  ))
  return [header, separator, ...body].join("\n")
}

function normalizeCellValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

function escapeCsvValue(value: string): string {
  if (!/[",\n\r]/.test(value)) return value
  return `"${value.replaceAll("\"", "\"\"")}"`
}

function escapeMarkdownCell(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\r\n", "<br>")
    .replaceAll("\n", "<br>")
    .replaceAll("\r", "<br>")
}

function sanitizeFileName(name: string): string {
  const value = name.trim().replace(/[\\/:*?"<>|]+/g, "-")
  return value || "table"
}

function createXlsxBlob(data: TableContentData): Blob {
  const files = new Map<string, string>([
    ["[Content_Types].xml", contentTypesXml()],
    ["_rels/.rels", rootRelationshipsXml()],
    ["docProps/app.xml", appPropertiesXml()],
    ["docProps/core.xml", corePropertiesXml()],
    ["xl/workbook.xml", workbookXml(data.tableName)],
    ["xl/_rels/workbook.xml.rels", workbookRelationshipsXml()],
    ["xl/styles.xml", stylesXml()],
    ["xl/worksheets/sheet1.xml", worksheetXml(data)],
  ])

  const archive = createZipArchive(files)
  const buffer = new ArrayBuffer(archive.byteLength)
  new Uint8Array(buffer).set(archive)

  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
}

function worksheetXml({ columns, rows }: TableContentData): string {
  const headerRow = columns.map((column, index) => cellXml(index, 1, column.name)).join("")
  const bodyRows = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 2
    const cells = columns.map((column, columnIndex) => (
      cellXml(columnIndex, rowNumber, normalizeCellValue(row[column.name]))
    )).join("")
    return `<row r="${rowNumber}">${cells}</row>`
  }).join("")

  return xmlDocument(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${headerRow}</row>${bodyRows}</sheetData></worksheet>`)
}

function cellXml(columnIndex: number, rowNumber: number, value: string): string {
  const reference = `${columnName(columnIndex)}${rowNumber}`
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
}

function columnName(index: number): string {
  let name = ""
  let value = index + 1
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

function workbookXml(tableName: string): string {
  return xmlDocument(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(tableName.slice(0, 31) || "Sheet1")}" sheetId="1" r:id="rId1"/></sheets></workbook>`)
}

function contentTypesXml(): string {
  return xmlDocument('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
}

function rootRelationshipsXml(): string {
  return xmlDocument('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>')
}

function workbookRelationshipsXml(): string {
  return xmlDocument('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
}

function appPropertiesXml(): string {
  return xmlDocument('<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Synapse</Application></Properties>')
}

function corePropertiesXml(): string {
  return xmlDocument('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Synapse</dc:creator></cp:coreProperties>')
}

function stylesXml(): string {
  return xmlDocument('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>')
}

function xmlDocument(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function createZipArchive(files: Map<string, string>): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const [name, content] of files) {
    const nameBytes = textEncoder.encode(name)
    const contentBytes = textEncoder.encode(content)
    const crc = crc32(contentBytes)
    const localHeader = createLocalFileHeader(nameBytes, contentBytes.length, crc)
    localParts.push(localHeader, contentBytes)
    centralParts.push(createCentralDirectoryHeader(nameBytes, contentBytes.length, crc, offset))
    offset += localHeader.length + contentBytes.length
  }

  const centralOffset = offset
  const centralSize = centralParts.reduce((size, part) => size + part.length, 0)
  const endRecord = createEndOfCentralDirectory(files.size, centralSize, centralOffset)
  const size = offset + centralSize + endRecord.length
  const archive = new Uint8Array(size)
  let position = 0

  for (const part of [...localParts, ...centralParts, endRecord]) {
    archive.set(part, position)
    position += part.length
  }

  return archive
}

function createLocalFileHeader(nameBytes: Uint8Array, contentSize: number, crc: number): Uint8Array {
  const header = new Uint8Array(30 + nameBytes.length)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x04034b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 0, true)
  view.setUint16(8, 0, true)
  view.setUint16(10, 0, true)
  view.setUint16(12, 0, true)
  view.setUint32(14, crc, true)
  view.setUint32(18, contentSize, true)
  view.setUint32(22, contentSize, true)
  view.setUint16(26, nameBytes.length, true)
  view.setUint16(28, 0, true)
  header.set(nameBytes, 30)
  return header
}

function createCentralDirectoryHeader(
  nameBytes: Uint8Array,
  contentSize: number,
  crc: number,
  localHeaderOffset: number,
): Uint8Array {
  const header = new Uint8Array(46 + nameBytes.length)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x02014b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 20, true)
  view.setUint16(8, 0, true)
  view.setUint16(10, 0, true)
  view.setUint16(12, 0, true)
  view.setUint16(14, 0, true)
  view.setUint32(16, crc, true)
  view.setUint32(20, contentSize, true)
  view.setUint32(24, contentSize, true)
  view.setUint16(28, nameBytes.length, true)
  view.setUint16(30, 0, true)
  view.setUint16(32, 0, true)
  view.setUint16(34, 0, true)
  view.setUint16(36, 0, true)
  view.setUint32(38, 0, true)
  view.setUint32(42, localHeaderOffset, true)
  header.set(nameBytes, 46)
  return header
}

function createEndOfCentralDirectory(fileCount: number, centralSize: number, centralOffset: number): Uint8Array {
  const record = new Uint8Array(22)
  const view = new DataView(record.buffer)
  view.setUint32(0, 0x06054b50, true)
  view.setUint16(4, 0, true)
  view.setUint16(6, 0, true)
  view.setUint16(8, fileCount, true)
  view.setUint16(10, fileCount, true)
  view.setUint32(12, centralSize, true)
  view.setUint32(16, centralOffset, true)
  view.setUint16(20, 0, true)
  return record
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export { downloadTableContent, formatTableContent }
export type { TableContentColumn, TableContentFormat, TableDownloadFormat }
