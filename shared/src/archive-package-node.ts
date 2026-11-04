import { createHash } from "node:crypto"
import { inflateRawSync } from "node:zlib"

export type InstallPackageLimits = {
  readonly maxCompressedBytes: number
  readonly maxEntries: number
  readonly maxFileBytes: number
  readonly maxManifestBytes: number
  readonly maxUncompressedBytes: number
  readonly maxCompressionRatio?: number
  readonly maxParseTimeMs?: number
  readonly strict?: { readonly maxDirectories: number; readonly maxDepth: number; readonly checkPath?: (path: string, directory: boolean) => void }
}

export type ZipEntry = {
  readonly name: string
  readonly bytes: Buffer
  readonly directory?: true
}

export function parseContentLength(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export function readZipEntries(archive: Buffer, limits: InstallPackageLimits): Map<string, ZipEntry> {
  const startedAt = performance.now()
  const strict = limits.strict
  if (strict && archive.length > limits.maxCompressedBytes) throw new Error("ZIP archive exceeds size limit")
  const endOffset = findEndOfCentralDirectory(archive, Boolean(strict))
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

  if (strict && centralOffset + centralSize !== endOffset) throw new Error("invalid ZIP end record")
  const entries = new Map<string, ZipEntry>()
  const localRanges: [number, number][] = []
  let directories = 0
  let cursor = centralOffset
  let totalCompressed = 0
  let totalUncompressed = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (limits.maxParseTimeMs !== undefined && performance.now() - startedAt > limits.maxParseTimeMs) {
      throw new Error("ZIP package parsing exceeded time limit")
    }
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
    const directory = Boolean(strict && name.endsWith("/"))
    const safeName = directory ? name.slice(0, -1) : name
    assertSafeArchivePath(safeName)
    if (strict) {
      strict.checkPath?.(safeName, directory)
      if (safeName.length > 1024 || safeName.split("/").some((part) => Buffer.byteLength(part) > 255)
        || safeName.split("/").length - (directory ? 0 : 1) > strict.maxDepth) {
        throw new Error("ZIP entry exceeds path limits")
      }
      if (directory && (++directories > strict.maxDirectories || uncompressedSize !== 0)) {
        throw new Error("invalid ZIP directory")
      }
      const fileType = (externalAttributes >>> 16) & 0o170000
      if ((fileType !== 0 && fileType !== (directory ? 0o040000 : 0o100000))
        || (!directory && (externalAttributes & 0x10) !== 0)) {
        throw new Error("unsupported ZIP file type")
      }
      if ((flags & ~0x080e) !== 0 || archive.readUInt16LE(cursor + 34) !== 0) {
        throw new Error("unsupported ZIP entry flags or disk")
      }
      assertSafeZipExtra(archive, cursor + 46 + nameLength, extraLength, archive.subarray(cursor + 46, cursor + 46 + nameLength))
      localRanges.push([localOffset, strictLocalEnd(archive, localOffset, centralOffset, flags, crc, compressedSize, uncompressedSize)])
    }
    if (entries.has(name)) throw new Error("duplicate ZIP entry")
    if ((flags & 0x0001) !== 0) throw new Error("encrypted ZIP entries are not supported")
    if (method !== 0 && method !== 8) throw new Error("unsupported ZIP compression method")
    if (((externalAttributes >>> 16) & 0o170000) === 0o120000) {
      throw new Error("ZIP symbolic links are not supported")
    }
    if (compressedSize > limits.maxCompressedBytes || uncompressedSize > limits.maxFileBytes) {
      throw new Error("ZIP entry exceeds size limit")
    }
    if (
      limits.maxCompressionRatio !== undefined
      && uncompressedSize / Math.max(compressedSize, 1) > limits.maxCompressionRatio
    ) {
      throw new Error("ZIP entry compression ratio exceeds limit")
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
      Boolean(strict),
    )
    if (limits.maxParseTimeMs !== undefined && performance.now() - startedAt > limits.maxParseTimeMs) {
      throw new Error("ZIP package parsing exceeded time limit")
    }
    if (crc32(bytes) !== crc) throw new Error("ZIP entry CRC does not match")
    entries.set(name, directory ? { name, bytes, directory: true } : { name, bytes })
    cursor = entryEnd
  }

  if (cursor !== centralOffset + centralSize) throw new Error("invalid ZIP central directory size")
  if (strict) {
    let next = 0
    for (const [start, end] of localRanges.sort((a, b) => a[0] - b[0])) {
      if (start !== next) throw new Error("overlapping or unindexed ZIP entries")
      next = end
    }
    if (next !== centralOffset) throw new Error("unindexed ZIP data")
  }
  return entries
}

function findEndOfCentralDirectory(archive: Buffer, strict: boolean): number {
  const minimumOffset = Math.max(0, archive.length - 65_557)
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50
      && (!strict || offset + 22 + archive.readUInt16LE(offset + 20) === archive.length)) return offset
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
  strict: boolean,
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
  const maxOutputLength = strict ? Math.max(1, Math.min(uncompressedSize, maxFileBytes)) : Math.min(uncompressedSize, maxFileBytes)
  if (strict && method === 8) {
    // Node returns the zlib engine with info: true; its sync typings only declare Buffer.
    const { buffer, engine } = inflateRawSync(compressed, { maxOutputLength, info: true }) as unknown as {
      buffer: Buffer; engine: { bytesWritten: number }
    }
    if (engine.bytesWritten !== compressedSize || buffer.length !== uncompressedSize) {
      throw new Error("ZIP deflate stream does not match entry sizes")
    }
    return buffer
  }
  const bytes = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength })
  if (bytes.length !== uncompressedSize) throw new Error("ZIP entry size does not match")
  return bytes
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

// Only known metadata fields with no alternate path or link semantics.
function assertSafeZipExtra(archive: Buffer, start: number, length: number, name: Buffer): void {
  const end = start + length
  while (start < end) {
    if (start + 4 > end) throw new Error("invalid ZIP extra field")
    const id = archive.readUInt16LE(start)
    const size = archive.readUInt16LE(start + 2)
    const data = start + 4
    start = data + size
    if (start > end) throw new Error("invalid ZIP extra field size")
    if (id === 0x7075) {
      if (size < 5 || archive[data] !== 1 || archive.readUInt32LE(data + 1) !== crc32(name)
        || !archive.subarray(data + 5, start).equals(name)) throw new Error("alternate ZIP entry name")
    } else if (id !== 0x5455 && id !== 0x7875 && id !== 0x000a) {
      throw new Error("unsupported ZIP extra field")
    }
  }
}

function strictLocalEnd(
  archive: Buffer, offset: number, centralOffset: number, flags: number,
  crc: number, compressed: number, uncompressed: number,
): number {
  if (offset + 30 > centralOffset || archive.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error("invalid ZIP local entry range")
  }
  const extraOffset = offset + 30 + archive.readUInt16LE(offset + 26)
  const extraLength = archive.readUInt16LE(offset + 28)
  const end = extraOffset + extraLength + compressed
  if (end > centralOffset) throw new Error("ZIP local entry overlaps central directory")
  assertSafeZipExtra(archive, extraOffset, extraLength, archive.subarray(offset + 30, extraOffset))
  const matches = (at: number) => archive.readUInt32LE(at) === crc
    && archive.readUInt32LE(at + 4) === compressed
    && archive.readUInt32LE(at + 8) === uncompressed
  if ((flags & 8) === 0) {
    if (!matches(offset + 14)) throw new Error("ZIP local sizes do not match")
    return end
  }
  if (end + 16 <= centralOffset && archive.readUInt32LE(end) === 0x08074b50 && matches(end + 4)) return end + 16
  if (end + 12 <= centralOffset && matches(end)) return end + 12
  throw new Error("invalid ZIP data descriptor")
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
