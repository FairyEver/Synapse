import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { inflateRawSync } from "node:zlib"

export type InstallPackageLimits = {
  readonly maxCompressedBytes: number
  readonly maxEntries: number
  readonly maxFileBytes: number
  readonly maxManifestBytes: number
  readonly maxUncompressedBytes: number
}

export type ZipEntry = {
  readonly name: string
  readonly bytes: Buffer
}

export function parseContentLength(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export function readZipEntries(archive: Buffer, limits: InstallPackageLimits): Map<string, ZipEntry> {
  const endOffset = findEndOfCentralDirectory(archive)
  const diskNumber = archive.readUInt16LE(endOffset + 4)
  const centralDisk = archive.readUInt16LE(endOffset + 6)
  const entriesOnDisk = archive.readUInt16LE(endOffset + 8)
  const entryCount = archive.readUInt16LE(endOffset + 10)
  const centralSize = archive.readUInt32LE(endOffset + 12)
  const centralOffset = archive.readUInt32LE(endOffset + 16)

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error("multi-disk ZIP packages are not supported")
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 packages are not supported")
  }
  if (entryCount > limits.maxEntries) throw new Error("too many ZIP entries")
  if (centralOffset + centralSize > endOffset) throw new Error("invalid ZIP central directory")

  const entries = new Map<string, ZipEntry>()
  let cursor = centralOffset
  let totalCompressed = 0
  let totalUncompressed = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralOffset + centralSize || archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("invalid ZIP central directory entry")
    }
    const flags = archive.readUInt16LE(cursor + 8)
    const method = archive.readUInt16LE(cursor + 10)
    const crc = archive.readUInt32LE(cursor + 16)
    const compressedSize = archive.readUInt32LE(cursor + 20)
    const uncompressedSize = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const externalAttributes = archive.readUInt32LE(cursor + 38)
    const localOffset = archive.readUInt32LE(cursor + 42)
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength
    if (entryEnd > centralOffset + centralSize) throw new Error("invalid ZIP entry metadata")

    const name = decodeUtf8(archive.subarray(cursor + 46, cursor + 46 + nameLength))
    assertSafeArchivePath(name)
    if (entries.has(name)) throw new Error("duplicate ZIP entry")
    if ((flags & 0x0001) !== 0) throw new Error("encrypted ZIP entries are not supported")
    if (method !== 0 && method !== 8) throw new Error("unsupported ZIP compression method")
    if (((externalAttributes >>> 16) & 0o170000) === 0o120000) {
      throw new Error("ZIP symbolic links are not supported")
    }
    if (compressedSize > limits.maxCompressedBytes || uncompressedSize > limits.maxFileBytes) {
      throw new Error("ZIP entry exceeds size limit")
    }
    totalCompressed += compressedSize
    totalUncompressed += uncompressedSize
    if (totalCompressed > limits.maxCompressedBytes) throw new Error("ZIP compressed data exceeds size limit")
    if (totalUncompressed > limits.maxUncompressedBytes) throw new Error("ZIP content exceeds size limit")

    const bytes = readZipEntryData(
      archive,
      localOffset,
      name,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      limits.maxFileBytes,
    )
    if (crc32(bytes) !== crc) throw new Error("ZIP entry CRC does not match")
    entries.set(name, { name, bytes })
    cursor = entryEnd
  }

  if (cursor !== centralOffset + centralSize) throw new Error("invalid ZIP central directory size")
  return entries
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimumOffset = Math.max(0, archive.length - 65_557)
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error("ZIP end of central directory not found")
}

function readZipEntryData(
  archive: Buffer,
  localOffset: number,
  expectedName: string,
  centralFlags: number,
  method: number,
  compressedSize: number,
  uncompressedSize: number,
  maxFileBytes: number,
): Buffer {
  if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error("invalid ZIP local entry")
  }
  const localFlags = archive.readUInt16LE(localOffset + 6)
  const localMethod = archive.readUInt16LE(localOffset + 8)
  const nameLength = archive.readUInt16LE(localOffset + 26)
  const extraLength = archive.readUInt16LE(localOffset + 28)
  const nameStart = localOffset + 30
  const dataStart = nameStart + nameLength + extraLength
  const dataEnd = dataStart + compressedSize
  if (dataEnd > archive.length) throw new Error("truncated ZIP entry data")
  const localName = decodeUtf8(archive.subarray(nameStart, nameStart + nameLength))
  if (localName !== expectedName || localFlags !== centralFlags || localMethod !== method) {
    throw new Error("ZIP local entry does not match central directory")
  }

  const compressed = archive.subarray(dataStart, dataEnd)
  const maxOutputLength = Math.min(uncompressedSize, maxFileBytes)
  const bytes = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength })
  if (bytes.length !== uncompressedSize) throw new Error("ZIP entry size does not match")
  return bytes
}

export async function materializeEntries(
  entries: Map<string, ZipEntry>,
  manifest: { readonly files: readonly { readonly path: string }[] },
  directoryPath: string,
): Promise<void> {
  for (const file of manifest.files) {
    const entry = entries.get(file.path)
    if (!entry) throw new Error("manifest file is missing from ZIP")
    const targetPath = path.join(directoryPath, ...file.path.split("/"))
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, entry.bytes, { flag: "wx" })
  }
}

export function assertSafeArchivePath(value: string): void {
  const segments = value.split("/")
  if (
    value.length === 0
    || value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:/.test(value)
    || segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
    || segments.some(isWindowsHostileArchivePathSegment)
  ) {
    throw new Error("unsafe ZIP entry path")
  }
}

const windowsReservedArchivePathNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const windowsHostileArchivePathSegmentChars = /[<>:"|?*\u0000-\u001f]/u

function isWindowsHostileArchivePathSegment(segment: string): boolean {
  return windowsHostileArchivePathSegmentChars.test(segment)
    || windowsReservedArchivePathNames.test(segment)
    || segment.endsWith(".")
    || segment.endsWith(" ")
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
