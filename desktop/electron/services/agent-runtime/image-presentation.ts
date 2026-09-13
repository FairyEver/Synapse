import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, realpath } from "node:fs/promises"
import path from "node:path"
import type { ConversationEntryV1 } from "../../runtime/data-repo"

export type PendingImagePresentation = NonNullable<ConversationEntryV1["contextHandoff"]>["pendingImages"][number]

export function mergePendingImages(...groups: readonly (readonly PendingImagePresentation[])[]): PendingImagePresentation[] {
  const images = new Map<string, PendingImagePresentation>()
  for (const group of groups) for (const image of group) images.set(image.toolUseId, image)
  return [...images.values()]
}

export function planImagePresentation(images: readonly PendingImagePresentation[], availableBytes: number) {
  // Leave room for native wrappers and the next response. One original is always
  // attempted: the SDK may resize it, and its actual native result is authoritative.
  const capacity = Math.max(0, availableBytes - 1024 * 1024)
  const selected: PendingImagePresentation[] = [], deferred: PendingImagePresentation[] = []
  let bytes = 0
  for (const image of images) {
    const estimatedBytes = Math.ceil(image.size / 3) * 4 + 4096
    if (!selected.length || bytes + estimatedBytes <= capacity) { selected.push(image); bytes += estimatedBytes }
    else deferred.push(image)
  }
  return { selected, deferred }
}

/** Called only for a native Read that already passed the SDK's read permission. */
export async function captureImagePresentation(filePath: string, cwd: string, toolUseId: string): Promise<PendingImagePresentation> {
  return captureNativeReadVersion(filePath, cwd, toolUseId)
}

/** Also bind a text receipt to the exact range of this original, not a later file version. */
export async function captureNativeReadVersion(filePath: string, cwd: string, toolUseId: string,
  expected?: { content: string; startLine: number; numLines: number }): Promise<PendingImagePresentation> {
  const absolute = path.resolve(cwd, filePath)
  const before = await lstat(absolute)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("图片原件无法安全验证。")
  const resolved = await realpath(absolute)
  const hash = createHash("sha256")
  let selected = "", line = 1
  const decoder = new TextDecoder()
  const inspect = (text: string) => {
    if (!expected) return
    let start = 0
    while (start < text.length) {
      const newline = text.indexOf("\n", start)
      const end = newline < 0 ? text.length : newline + 1
      if (line >= expected.startLine && line < expected.startLine + expected.numLines) {
        selected += text.slice(start, end)
        if (selected.length > expected.content.length + expected.numLines + 2) throw new Error("读取内容与原件不一致。")
      }
      start = end
      if (newline >= 0) line += 1
    }
  }
  for await (const chunk of createReadStream(resolved)) {
    hash.update(chunk)
    if (expected) inspect(decoder.decode(chunk, { stream: true }))
  }
  if (expected) {
    inspect(decoder.decode())
    const normalize = (value: string) => value.replace(/\r\n/g, "\n").replace(/\n$/, "")
    if (normalize(selected) !== normalize(expected.content)) throw new Error("读取内容与原件不一致。")
  }
  const after = await lstat(absolute)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino
    || resolved !== await realpath(absolute)) throw new Error("图片原件已变化，无法继续呈现。")
  return { path: resolved, sha256: hash.digest("hex"), size: after.size, toolUseId, attempts: 0 }
}

export async function verifyImagePresentation(image: PendingImagePresentation): Promise<void> {
  const current = await captureImagePresentation(image.path, "/", image.toolUseId)
  if (current.sha256 !== image.sha256 || current.size !== image.size) {
    throw new Error("图片原件已变化，无法继续呈现。")
  }
}
