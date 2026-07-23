import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

export type TerminalPersistenceProtection = "available" | "unavailable" | "degraded"

export type TerminalSafeStorage = {
  isEncryptionAvailable(): boolean
  encryptString(plaintext: string): Buffer
  decryptString(ciphertext: Buffer): string
}

type EncryptedBlockEnvelopeV1 = {
  readonly schemaVersion: 1
  readonly blockId: string
  readonly sessionId: string
  readonly type: "output" | "checkpoint"
  readonly nonce: string
  readonly authTag: string
  readonly ciphertext: string
}

export type TerminalBlockWriteResult = {
  readonly blockId: string
  readonly byteLength: number
  readonly sha256: string
  readonly persisted: boolean
}

export type TerminalEncryptedBlockStore = ReturnType<typeof createTerminalEncryptedBlockStore>

const KEY_BYTES = 32
const NONCE_BYTES = 12
const KEY_FILE_SCHEMA_V1 = "terminal-data-key-v1"
const KEY_FILE_SCHEMA_V2 = "terminal-data-key-v2"

export function createTerminalEncryptedBlockStore(options: {
  readonly baseDir: string
  readonly safeStorage: TerminalSafeStorage
}) {
  const blocksDir = path.join(options.baseDir, "blocks-v1")
  const keyFilePath = path.join(options.baseDir, "terminal-data-key-v1.bin")
  let dataKeys: Buffer[] = []
  let protection: TerminalPersistenceProtection = options.safeStorage.isEncryptionAvailable()
    ? "available"
    : "unavailable"

  async function initialize(): Promise<TerminalPersistenceProtection> {
    if (!options.safeStorage.isEncryptionAvailable()) {
      dataKeys = []
      protection = "unavailable"
      return protection
    }
    await mkdir(options.baseDir, { recursive: true })
    await mkdir(blocksDir, { recursive: true })
    try {
      const protectedKey = await readFile(keyFilePath)
      const decoded = JSON.parse(options.safeStorage.decryptString(protectedKey)) as {
        schema?: unknown
        key?: unknown
        keys?: unknown
      }
      if (decoded.schema === KEY_FILE_SCHEMA_V1 && typeof decoded.key === "string") {
        dataKeys = [decodeDataKey(decoded.key)]
      } else if (decoded.schema === KEY_FILE_SCHEMA_V2 && Array.isArray(decoded.keys) && decoded.keys.length > 0) {
        dataKeys = decoded.keys.map((value) => {
          if (typeof value !== "string") throw new Error("Invalid Terminal data-key envelope")
          return decodeDataKey(value)
        })
      } else {
        throw new Error("Invalid Terminal data-key envelope")
      }
      protection = "available"
      return protection
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        dataKeys = []
        protection = "degraded"
        return protection
      }
    }

    const created = randomBytes(KEY_BYTES)
    const protectedKey = options.safeStorage.encryptString(JSON.stringify({
      schema: KEY_FILE_SCHEMA_V2,
      keys: [created.toString("base64")],
    }))
    await atomicWrite(keyFilePath, protectedKey)
    dataKeys = [created]
    protection = "available"
    return protection
  }

  async function writeBlock(input: {
    readonly sessionId: string
    readonly type: "output" | "checkpoint"
    readonly plaintext: Buffer
    readonly blockId?: string
  }): Promise<TerminalBlockWriteResult> {
    const blockId = input.blockId ?? randomUUID()
    const sha256 = createHash("sha256").update(input.plaintext).digest("hex")
    if (!dataKeys[0] || protection !== "available") {
      return { blockId, byteLength: input.plaintext.byteLength, sha256, persisted: false }
    }

    const nonce = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv("aes-256-gcm", dataKeys[0], nonce)
    cipher.setAAD(createAad({ blockId, sessionId: input.sessionId, type: input.type }))
    const ciphertext = Buffer.concat([cipher.update(input.plaintext), cipher.final()])
    const envelope: EncryptedBlockEnvelopeV1 = {
      schemaVersion: 1,
      blockId,
      sessionId: input.sessionId,
      type: input.type,
      nonce: nonce.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    }
    await mkdir(blocksDir, { recursive: true })
    await atomicWrite(blockPath(blockId), Buffer.from(JSON.stringify(envelope), "utf8"))
    return { blockId, byteLength: input.plaintext.byteLength, sha256, persisted: true }
  }

  async function readBlock(input: {
    readonly blockId: string
    readonly sessionId: string
    readonly type: "output" | "checkpoint"
    readonly expectedSha256: string
  }): Promise<Buffer> {
    if (!dataKeys.length || protection !== "available") {
      throw new Error("Terminal persistence protection unavailable")
    }
    const envelope = parseEnvelope(JSON.parse(await readFile(blockPath(input.blockId), "utf8")))
    if (
      envelope.blockId !== input.blockId
      || envelope.sessionId !== input.sessionId
      || envelope.type !== input.type
    ) {
      throw new Error("Terminal block ownership mismatch")
    }
    const plaintext = decryptWithKeyring(envelope, input, dataKeys)
    const actualSha256 = createHash("sha256").update(plaintext).digest("hex")
    if (actualSha256 !== input.expectedSha256) throw new Error("Terminal block digest mismatch")
    return plaintext
  }

  async function rotateDataKey(blocks: readonly {
    readonly blockId: string
    readonly sessionId: string
    readonly type: "output" | "checkpoint"
    readonly expectedSha256: string
  }[]): Promise<void> {
    if (!dataKeys[0] || protection !== "available") {
      throw new Error("Terminal persistence protection unavailable")
    }
    const plaintext = await Promise.all(blocks.map(async (block) => ({
      block,
      value: await readBlock(block),
    })))
    const nextKey = randomBytes(KEY_BYTES)
    const previousKeys = dataKeys
    dataKeys = [nextKey, ...previousKeys]
    try {
      await persistKeyring(keyFilePath, dataKeys, options.safeStorage)
    } catch (error) {
      dataKeys = previousKeys
      throw error
    }
    try {
      for (const item of plaintext) {
        const result = await writeBlock({ ...item.block, plaintext: item.value })
        if (!result.persisted) throw new Error("Terminal block key rotation was not persisted")
      }
      dataKeys = [nextKey]
      await persistKeyring(keyFilePath, dataKeys, options.safeStorage)
    } catch (error) {
      dataKeys = [nextKey, ...previousKeys]
      throw error
    }
  }

  async function deleteBlock(blockId: string): Promise<void> {
    await unlink(blockPath(blockId)).catch((error) => {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error
    })
  }

  async function listBlockIds(): Promise<string[]> {
    try {
      const entries = await readdir(blocksDir, { withFileTypes: true })
      return entries.flatMap((entry) => {
        if (!entry.isFile() || !entry.name.endsWith(".block")) return []
        const blockId = entry.name.slice(0, -".block".length)
        return /^[0-9a-f-]{36}$/i.test(blockId) ? [blockId] : []
      })
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return []
      throw error
    }
  }

  function blockPath(blockId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(blockId)) throw new Error("Invalid Terminal block id")
    return path.join(blocksDir, `${blockId}.block`)
  }

  return {
    initialize,
    writeBlock,
    readBlock,
    deleteBlock,
    listBlockIds,
    rotateDataKey,
    get persistenceProtection(): TerminalPersistenceProtection {
      return protection
    },
  }
}

function createAad(input: {
  readonly blockId: string
  readonly sessionId: string
  readonly type: "output" | "checkpoint"
}): Buffer {
  return Buffer.from(JSON.stringify({
    blockId: input.blockId,
    sessionId: input.sessionId,
    type: input.type,
    schemaVersion: 1,
  }), "utf8")
}

function decodeDataKey(value: string): Buffer {
  const key = Buffer.from(value, "base64")
  if (key.byteLength !== KEY_BYTES) throw new Error("Invalid Terminal data-key length")
  return key
}

function decryptWithKeyring(
  envelope: EncryptedBlockEnvelopeV1,
  input: { readonly blockId: string; readonly sessionId: string; readonly type: "output" | "checkpoint" },
  keys: readonly Buffer[],
): Buffer {
  let lastError: unknown
  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64"))
      decipher.setAAD(createAad(input))
      decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"))
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ])
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Terminal block decryption failed")
}

async function persistKeyring(
  keyFilePath: string,
  keys: readonly Buffer[],
  safeStorage: TerminalSafeStorage,
): Promise<void> {
  const protectedKey = safeStorage.encryptString(JSON.stringify({
    schema: KEY_FILE_SCHEMA_V2,
    keys: keys.map((key) => key.toString("base64")),
  }))
  await atomicWrite(keyFilePath, protectedKey)
}

function parseEnvelope(value: unknown): EncryptedBlockEnvelopeV1 {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.blockId !== "string"
    || typeof value.sessionId !== "string"
    || (value.type !== "output" && value.type !== "checkpoint")
    || typeof value.nonce !== "string"
    || typeof value.authTag !== "string"
    || typeof value.ciphertext !== "string") {
    throw new Error("Invalid Terminal block envelope")
  }
  return value as EncryptedBlockEnvelopeV1
}

async function atomicWrite(filePath: string, bytes: Buffer): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.staging`
  try {
    await writeFile(tempPath, bytes, { mode: 0o600 })
    await rename(tempPath, filePath)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
