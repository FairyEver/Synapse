import { createHash } from "node:crypto"
import { addAbortSignal } from "node:stream"
import type { SkillHubStoragePort } from "./skill-hub-storage"

export type HubObjectLocation = { storageKey: string; size: number; sha256: string }

export async function openSkillHubObject(storage: SkillHubStoragePort, object: HubObjectLocation, max: number) {
  if (!Number.isSafeInteger(object.size) || object.size < 1 || object.size > max) throw new Error("Invalid object length")
  const response = await storage.open(object.storageKey)
  if (response.size !== object.size) {
    response.stream.destroy()
    throw new Error("Unexpected object length")
  }
  return response
}

export async function consumeVerifiedHubObject(
  storage: SkillHubStoragePort, object: HubObjectLocation, max: number, onChunk?: (chunk: Buffer) => void | Promise<void>,
  signal: AbortSignal = AbortSignal.timeout(30_000),
): Promise<void> {
  signal.throwIfAborted()
  const { stream } = await openSkillHubObject(storage, object, max)
  const hash = createHash("sha256")
  let length = 0
  for await (const chunk of addAbortSignal(signal, stream)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += bytes.length
    if (length > object.size) throw new Error("Unexpected object length")
    hash.update(bytes)
    await onChunk?.(bytes)
  }
  if (length !== object.size || hash.digest("hex") !== object.sha256) throw new Error("Object integrity verification failed")
}

export async function verifySkillHubObject(storage: SkillHubStoragePort, object: HubObjectLocation, max: number): Promise<void> {
  await consumeVerifiedHubObject(storage, object, max)
}
