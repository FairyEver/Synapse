import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, realpath } from "node:fs/promises"
import path from "node:path"
import type { ConversationEntryV1 } from "../../runtime/data-repo"

export type PendingImagePresentation = NonNullable<ConversationEntryV1["contextHandoff"]>["pendingImages"][number]

/** Called only for a native Read that already passed the SDK's read permission. */
export async function captureImagePresentation(filePath: string, cwd: string, toolUseId: string): Promise<PendingImagePresentation> {
  const absolute = path.resolve(cwd, filePath)
  const before = await lstat(absolute)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("图片原件无法安全验证。")
  const resolved = await realpath(absolute)
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(resolved)) hash.update(chunk)
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
