import { constants } from "node:fs"
import { mkdir, lstat, open, link, unlink, realpath } from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { Readable } from "node:stream"

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
export class AssetSizeLimitError extends Error {
  constructor() { super("Asset size limit exceeded"); this.name = "AssetSizeLimitError" }
}

/** Infrastructure-only file bytes. Ownership, consent and reference lifetime belong to callers. */
export class ManagedAssetStore {
  constructor(private readonly rootDir: string) {}

  private async filePath(key: string): Promise<string> {
    if (!KEY_PATTERN.test(key)) throw new Error("Invalid asset key")
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 })
    const root = await lstat(this.rootDir)
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Invalid asset root")
    return path.join(this.rootDir, key)
  }

  async put(source: Readable, maxBytes: number, signal?: AbortSignal, key: string = randomUUID()): Promise<{ key: string; size: number; sha256: string }> {
    const destination = await this.filePath(key)
    const temporary = `${destination}.part`
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    let size = 0
    const hash = createHash("sha256")
    try {
      for await (const chunk of source) {
        signal?.throwIfAborted()
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += bytes.length
        if (size > maxBytes) throw new AssetSizeLimitError()
        hash.update(bytes)
        let offset = 0
        while (offset < bytes.length) offset += (await file.write(bytes, offset, bytes.length - offset)).bytesWritten
      }
      signal?.throwIfAborted()
      await file.sync()
      await file.close()
      await link(temporary, destination)
      await unlink(temporary)
      return { key, size, sha256: hash.digest("hex") }
    } catch (error) {
      await file.close()
      try { await unlink(temporary) } catch (cleanup) {
        if ((cleanup as NodeJS.ErrnoException).code !== "ENOENT") throw new AggregateError([error, cleanup], "Asset write and cleanup failed")
      }
      throw error
    }
  }

  async read(key: string, maxBytes: number): Promise<Buffer> {
    const file = await open(await this.filePath(key), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (!stat.isFile()) throw new Error("Invalid asset file")
      if (stat.size > maxBytes) throw new AssetSizeLimitError()
      const chunks: Buffer[] = []
      let size = 0
      const stream = file.createReadStream({ autoClose: false })
      for await (const bytes of stream) {
        size += bytes.length
        if (size > maxBytes) throw new AssetSizeLimitError()
        chunks.push(bytes)
      }
      return Buffer.concat(chunks, size)
    } finally { await file.close() }
  }

  async open(key: string): Promise<Readable> {
    const file = await open(await this.filePath(key), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (!stat.isFile()) throw new Error("Invalid asset file")
      return file.createReadStream({ autoClose: true })
    } catch (error) { await file.close(); throw error }
  }

  async remove(key: string, partial = false): Promise<void> {
    try { await unlink((await this.filePath(key)) + (partial ? ".part" : "")) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
}

/** Canonical path for permission checks; the final component must not be a symlink. */
export async function externalAssetPath(input: string): Promise<string> {
  if (!path.isAbsolute(input) || input.includes("\0")) throw new Error("An absolute file path is required")
  const normalized = path.resolve(input)
  const parent = await realpath(path.dirname(normalized))
  return path.join(parent, path.basename(normalized))
}

export async function openExternalAsset(filePath: string, maxBytes: number, signal: AbortSignal): Promise<Readable> {
  signal.throwIfAborted()
  const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw new Error("Invalid asset file")
    if (stat.size > maxBytes) throw new AssetSizeLimitError()
    signal.throwIfAborted()
    const stream = file.createReadStream({ autoClose: true })
    const abort = () => stream.destroy(new Error("Asset read cancelled"))
    signal.addEventListener("abort", abort, { once: true })
    stream.once("close", () => signal.removeEventListener("abort", abort))
    return stream
  } catch (error) { await file.close(); throw error }
}

/** Exclusive export: never overwrite a caller's existing file. Callers authorize the canonical path. */
export async function exportExternalAsset(source: Readable, filePath: string, maxBytes: number, signal: AbortSignal): Promise<{ size: number; sha256: string }> {
  const file = await open(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  const hash = createHash("sha256")
  let size = 0
  try {
    for await (const chunk of source) {
      signal.throwIfAborted()
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > maxBytes) throw new AssetSizeLimitError()
      hash.update(bytes)
      let offset = 0
      while (offset < bytes.length) offset += (await file.write(bytes, offset, bytes.length - offset)).bytesWritten
    }
    signal.throwIfAborted(); await file.sync(); await file.close()
    return { size, sha256: hash.digest("hex") }
  } catch (error) {
    source.destroy(); await file.close()
    try { await unlink(filePath) } catch (cleanup) { if ((cleanup as NodeJS.ErrnoException).code !== "ENOENT") throw new AggregateError([error, cleanup], "Asset export and cleanup failed") }
    throw error
  }
}
