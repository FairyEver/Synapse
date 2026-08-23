import archiver from "archiver"
import type { Response } from "express"
import { Buffer } from "node:buffer"
import { Readable, Transform } from "node:stream"
import { attachmentContentDisposition } from "../common/content-disposition"
import type { DriveStoragePort } from "./drive-storage"

export type DriveDownloadArchiveEntry = {
  readonly path: string
  readonly storageKey: string | null
}

export async function sendDriveZip(
  response: Response,
  filename: string,
  entries: AsyncIterable<DriveDownloadArchiveEntry>,
  storage: DriveStoragePort,
  options: { readonly onBytes?: (bytes: bigint) => void } = {},
): Promise<void> {
  response.setHeader("Content-Type", "application/zip")
  response.setHeader("Content-Disposition", attachmentContentDisposition(filename))
  const archive = archiver("zip", { zlib: { level: 6 } })
  const archiveError = new Promise<never>((_, reject) => {
    archive.once("error", reject)
  })
  const activeObjectStreams = new Set<Readable>()
  let responseBytes = 0n
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      responseBytes += BigInt(chunk.byteLength)
      options.onBytes?.(responseBytes)
      callback(null, chunk)
    },
  })
  let rejectResponseClosed: ((error: Error) => void) | null = null
  const responseClosed = new Promise<never>((_, reject) => {
    rejectResponseClosed = reject
  })
  const handleResponseClose = () => {
    if (response.writableFinished) return
    const error = new Error("Drive zip response closed before completion.")
    for (const stream of activeObjectStreams) stream.destroy()
    archive.destroy()
    counter.destroy()
    rejectResponseClosed?.(error)
  }
  response.once("close", handleResponseClose)
  archive.pipe(counter).pipe(response)
  try {
    for await (const entry of entries) {
      if (entry.storageKey === null) {
        archive.append(Buffer.alloc(0), { name: ensureDriveZipDirectoryPath(entry.path) })
        continue
      }
      const object = await storage.getObjectStream({ key: entry.storageKey })
      const objectStream = object.stream as unknown as Readable
      activeObjectStreams.add(objectStream)
      const forgetObjectStream = () => activeObjectStreams.delete(objectStream)
      objectStream.once("close", forgetObjectStream)
      objectStream.once("end", forgetObjectStream)
      archive.append(objectStream, { name: entry.path })
    }
    await Promise.race([archive.finalize(), archiveError, responseClosed])
  } catch (error) {
    for (const stream of activeObjectStreams) stream.destroy()
    archive.destroy()
    if (!response.headersSent) throw error
    response.destroy(error instanceof Error ? error : new Error("Drive zip stream failed."))
    throw error
  } finally {
    response.off("close", handleResponseClose)
  }
}

function ensureDriveZipDirectoryPath(path: string): string {
  return path.endsWith("/") ? path : `${path}/`
}
