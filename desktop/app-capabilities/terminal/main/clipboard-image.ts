import { randomUUID } from "node:crypto"
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

const MAX_CLIPBOARD_IMAGE_BYTES = 10 * 1024 * 1024
const CLIPBOARD_IMAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const CLIPBOARD_IMAGE_PREFIX = "clipboard-image-"

type ClipboardImage = {
  isEmpty: () => boolean
  toPNG: () => Buffer
}

type ClipboardSource = {
  readText: () => string
  readImage: () => ClipboardImage
}

type MaterializeClipboardImageInput = {
  clipboard: ClipboardSource
  directory: string
  now?: number
  createId?: () => string
  onCleanupError?: (error: unknown) => void
}

export async function materializeTerminalClipboardImage(
  input: MaterializeClipboardImageInput,
): Promise<string | null> {
  if (input.clipboard.readText().length > 0) return null

  const image = input.clipboard.readImage()
  if (image.isEmpty()) return null

  const png = image.toPNG()
  if (png.byteLength > MAX_CLIPBOARD_IMAGE_BYTES) {
    throw new Error("Clipboard image exceeds the 10 MB terminal paste limit.")
  }

  await mkdir(input.directory, { recursive: true, mode: 0o700 })
  await removeStaleClipboardImages(
    input.directory,
    input.now ?? Date.now(),
    input.onCleanupError,
  )

  const filePath = path.join(
    input.directory,
    `${CLIPBOARD_IMAGE_PREFIX}${input.createId?.() ?? randomUUID()}.png`,
  )
  await writeFile(filePath, png, { flag: "wx", mode: 0o600 })
  return filePath
}

async function removeStaleClipboardImages(
  directory: string,
  now: number,
  onCleanupError?: (error: unknown) => void,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !isClipboardImageFile(entry.name)) return
    const filePath = path.join(directory, entry.name)
    try {
      const metadata = await stat(filePath)
      if (now - metadata.mtimeMs > CLIPBOARD_IMAGE_MAX_AGE_MS) await unlink(filePath)
    } catch (error) {
      onCleanupError?.(error)
    }
  }))
}

function isClipboardImageFile(fileName: string): boolean {
  return fileName.startsWith(CLIPBOARD_IMAGE_PREFIX) && fileName.endsWith(".png")
}
