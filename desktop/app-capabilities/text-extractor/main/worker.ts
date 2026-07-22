import { parentPort, workerData } from "node:worker_threads"
import mammoth from "mammoth"
import PizZip from "pizzip"
import { extractText, getDocumentProxy } from "unpdf"
import type {
  TextExtractionWorkerInput,
  TextExtractionWorkerMessage,
} from "./worker-protocol.js"

function post(message: TextExtractionWorkerMessage): void {
  parentPort?.postMessage(message)
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replaceAll("\0", "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function isPasswordError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === "PasswordException" || /password/i.test(error.message)
}

async function extractPdf(
  input: TextExtractionWorkerInput,
): Promise<TextExtractionWorkerMessage> {
  let document
  try {
    document = await getDocumentProxy(new Uint8Array(input.bytes))
  } catch (error) {
    return {
      type: "error",
      code: isPasswordError(error) ? "PASSWORD_PROTECTED" : "INVALID_DOCUMENT",
    }
  }

  try {
    if (document.numPages > input.maxPages) {
      return { type: "error", code: "PDF_PAGE_LIMIT_EXCEEDED" }
    }

    let pages: string[]
    try {
      const extracted = await extractText(document, { mergePages: false })
      pages = extracted.text
    } catch (error) {
      return {
        type: "error",
        code: isPasswordError(error) ? "PASSWORD_PROTECTED" : "EXTRACTION_FAILED",
      }
    }

    const text = normalizeText(pages.join("\n\n"))
    if (Buffer.byteLength(text, "utf8") > input.maxTextBytes) {
      return { type: "error", code: "TEXT_TOO_LARGE" }
    }
    return {
      type: "success",
      result: { text, pages: document.numPages },
    }
  } finally {
    await document.destroy()
  }
}

async function extractDocx(
  input: TextExtractionWorkerInput,
): Promise<TextExtractionWorkerMessage> {
  const buffer = Buffer.from(input.bytes)
  if (isEncryptedOfficeDocument(buffer)) {
    return { type: "error", code: "PASSWORD_PROTECTED" }
  }
  try {
    const zip = new PizZip(buffer)
    if (!zip.file("word/document.xml")) {
      return { type: "error", code: "INVALID_DOCUMENT" }
    }
  } catch {
    return { type: "error", code: "INVALID_DOCUMENT" }
  }

  try {
    const extracted = await mammoth.extractRawText({ buffer })
    const text = normalizeText(extracted.value)
    if (Buffer.byteLength(text, "utf8") > input.maxTextBytes) {
      return { type: "error", code: "TEXT_TOO_LARGE" }
    }
    const warnings = extracted.messages.filter((message) => message.type === "warning")
    return {
      type: "success",
      result: {
        text,
        ...(warnings.length === 0
          ? {}
          : {
              warningCount: warnings.length,
              warningCategories: [...new Set(warnings.map(classifyMammothWarning))].sort(),
            }),
      },
    }
  } catch (error) {
    return {
      type: "error",
      code: isPasswordError(error) ? "PASSWORD_PROTECTED" : "INVALID_DOCUMENT",
    }
  }
}

function isEncryptedOfficeDocument(bytes: Buffer): boolean {
  const compoundFileHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  if (!bytes.subarray(0, compoundFileHeader.length).equals(compoundFileHeader)) return false
  try {
    const streamNames = readCompoundFileStreamNames(bytes)
    return streamNames.has("EncryptionInfo") && streamNames.has("EncryptedPackage")
  } catch {
    return false
  }
}

const COMPOUND_FILE_END_OF_CHAIN = 0xfffffffe
const COMPOUND_FILE_FREE_SECTOR = 0xffffffff
const COMPOUND_FILE_MAX_REGULAR_SECTOR = 0xfffffffa

function readCompoundFileStreamNames(bytes: Buffer): ReadonlySet<string> {
  if (bytes.length < 512 || bytes.readUInt16LE(28) !== 0xfffe) {
    throw new Error("Invalid compound file header")
  }
  const majorVersion = bytes.readUInt16LE(26)
  const sectorShift = bytes.readUInt16LE(30)
  if ((majorVersion !== 3 || sectorShift !== 9) && (majorVersion !== 4 || sectorShift !== 12)) {
    throw new Error("Unsupported compound file version")
  }
  const sectorSize = 2 ** sectorShift
  if (bytes.length % sectorSize !== 0) throw new Error("Truncated compound file")
  const sectorCount = bytes.length / sectorSize - 1
  const readSector = (sectorId: number): Buffer => {
    if (sectorId > COMPOUND_FILE_MAX_REGULAR_SECTOR || sectorId >= sectorCount) {
      throw new Error("Invalid compound file sector")
    }
    const offset = (sectorId + 1) * sectorSize
    return bytes.subarray(offset, offset + sectorSize)
  }

  const fatSectorCount = bytes.readUInt32LE(44)
  if (fatSectorCount > sectorCount) throw new Error("Invalid compound file FAT")
  const fatSectorIds: number[] = []
  for (let offset = 76; offset < 512 && fatSectorIds.length < fatSectorCount; offset += 4) {
    const sectorId = bytes.readUInt32LE(offset)
    if (sectorId !== COMPOUND_FILE_FREE_SECTOR) fatSectorIds.push(sectorId)
  }
  let difatSectorId = bytes.readUInt32LE(68)
  const difatSectorCount = bytes.readUInt32LE(72)
  const visitedDifatSectors = new Set<number>()
  for (let index = 0; index < difatSectorCount && fatSectorIds.length < fatSectorCount; index += 1) {
    if (visitedDifatSectors.has(difatSectorId)) throw new Error("Cyclic compound file DIFAT")
    visitedDifatSectors.add(difatSectorId)
    const sector = readSector(difatSectorId)
    for (let offset = 0; offset < sectorSize - 4 && fatSectorIds.length < fatSectorCount; offset += 4) {
      const sectorId = sector.readUInt32LE(offset)
      if (sectorId !== COMPOUND_FILE_FREE_SECTOR) fatSectorIds.push(sectorId)
    }
    difatSectorId = sector.readUInt32LE(sectorSize - 4)
  }
  if (fatSectorIds.length !== fatSectorCount) throw new Error("Incomplete compound file FAT")

  const fat: number[] = []
  for (const fatSectorId of fatSectorIds) {
    const sector = readSector(fatSectorId)
    for (let offset = 0; offset < sectorSize; offset += 4) {
      fat.push(sector.readUInt32LE(offset))
    }
  }

  const streamNames = new Set<string>()
  const visitedDirectorySectors = new Set<number>()
  let directorySectorId = bytes.readUInt32LE(48)
  while (directorySectorId !== COMPOUND_FILE_END_OF_CHAIN) {
    if (visitedDirectorySectors.has(directorySectorId)) {
      throw new Error("Cyclic compound file directory")
    }
    visitedDirectorySectors.add(directorySectorId)
    const sector = readSector(directorySectorId)
    for (let offset = 0; offset < sectorSize; offset += 128) {
      const nameLength = sector.readUInt16LE(offset + 64)
      const objectType = sector[offset + 66]
      if (objectType !== 2 || nameLength < 2 || nameLength > 64 || nameLength % 2 !== 0) continue
      if (sector.readUInt16LE(offset + nameLength - 2) !== 0) continue
      const startingSector = sector.readUInt32LE(offset + 116)
      const streamSize = Number(sector.readBigUInt64LE(offset + 120))
      if (startingSector > COMPOUND_FILE_MAX_REGULAR_SECTOR || streamSize <= 0) continue
      streamNames.add(sector.subarray(offset, offset + nameLength - 2).toString("utf16le"))
    }
    const nextDirectorySectorId = fat[directorySectorId]
    if (nextDirectorySectorId === undefined) throw new Error("Incomplete compound file directory")
    directorySectorId = nextDirectorySectorId
  }
  return streamNames
}

function classifyMammothWarning(message: { readonly message: string }): string {
  if (/unrecognised element/i.test(message.message)) return "unrecognized-element"
  if (/style/i.test(message.message)) return "style"
  if (/image/i.test(message.message)) return "image"
  return "other"
}

const input = workerData as TextExtractionWorkerInput
void (input.format === "docx" ? extractDocx(input) : extractPdf(input))
  .then(post)
  .catch(() => post({ type: "error", code: "EXTRACTION_FAILED" }))
