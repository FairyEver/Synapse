import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { createTerminalEncryptedBlockStore, type TerminalSafeStorage } from "../encrypted-block-store"

function fakeSafeStorage(available = true): TerminalSafeStorage {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").slice("protected:".length),
  }
}

describe("Terminal encrypted block store", () => {
  it("authenticates each body against block ownership and does not persist plaintext", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-blocks-"))
    const store = createTerminalEncryptedBlockStore({ baseDir, safeStorage: fakeSafeStorage() })
    await expect(store.initialize()).resolves.toBe("available")
    const plaintext = Buffer.from("private terminal output", "utf8")
    const written = await store.writeBlock({
      sessionId: "11111111-1111-4111-8111-111111111111",
      type: "output",
      plaintext,
    })
    expect(written.persisted).toBe(true)
    const diskBytes = await readFile(path.join(baseDir, "blocks-v1", `${written.blockId}.block`))
    expect(diskBytes.includes(plaintext)).toBe(false)
    await expect(store.readBlock({
      blockId: written.blockId,
      sessionId: "11111111-1111-4111-8111-111111111111",
      type: "output",
      expectedSha256: written.sha256,
    })).resolves.toEqual(plaintext)
    await expect(store.readBlock({
      blockId: written.blockId,
      sessionId: "22222222-2222-4222-8222-222222222222",
      type: "output",
      expectedSha256: written.sha256,
    })).rejects.toThrow("ownership")
  })

  it("keeps output memory-only when safe storage is unavailable", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-blocks-"))
    const store = createTerminalEncryptedBlockStore({ baseDir, safeStorage: fakeSafeStorage(false) })
    await expect(store.initialize()).resolves.toBe("unavailable")
    await expect(store.writeBlock({
      sessionId: "11111111-1111-4111-8111-111111111111",
      type: "output",
      plaintext: Buffer.from("memory only"),
    })).resolves.toMatchObject({ persisted: false })
  })

  it("rejects ciphertext corruption without deleting the structural record", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-blocks-"))
    const store = createTerminalEncryptedBlockStore({ baseDir, safeStorage: fakeSafeStorage() })
    await store.initialize()
    const written = await store.writeBlock({
      sessionId: "11111111-1111-4111-8111-111111111111",
      type: "checkpoint",
      plaintext: Buffer.from("checkpoint"),
    })
    const filePath = path.join(baseDir, "blocks-v1", `${written.blockId}.block`)
    const envelope = JSON.parse(await readFile(filePath, "utf8")) as { ciphertext: string }
    envelope.ciphertext = Buffer.from("corrupt").toString("base64")
    await writeFile(filePath, JSON.stringify(envelope), "utf8")
    await expect(store.readBlock({
      blockId: written.blockId,
      sessionId: "11111111-1111-4111-8111-111111111111",
      type: "checkpoint",
      expectedSha256: written.sha256,
    })).rejects.toThrow()
  })

  it("rotates the protected data key without changing block identity or plaintext", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "synapse-terminal-blocks-"))
    const safeStorage = fakeSafeStorage()
    const store = createTerminalEncryptedBlockStore({ baseDir, safeStorage })
    await store.initialize()
    const sessionId = "11111111-1111-4111-8111-111111111111"
    const plaintext = Buffer.from("rotate me")
    const written = await store.writeBlock({ sessionId, type: "output", plaintext })
    const before = await readFile(path.join(baseDir, "blocks-v1", `${written.blockId}.block`))
    await store.rotateDataKey([{ blockId: written.blockId, sessionId, type: "output", expectedSha256: written.sha256 }])
    const after = await readFile(path.join(baseDir, "blocks-v1", `${written.blockId}.block`))
    expect(after).not.toEqual(before)
    const restarted = createTerminalEncryptedBlockStore({ baseDir, safeStorage })
    await expect(restarted.initialize()).resolves.toBe("available")
    await expect(restarted.readBlock({
      blockId: written.blockId, sessionId, type: "output", expectedSha256: written.sha256,
    })).resolves.toEqual(plaintext)
  })
})
