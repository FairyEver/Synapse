import { describe, expect, it } from "vitest"
import { mkdtemp, rm, writeFile, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  EncryptedJsonNamespace,
  type SafeStorage,
} from "../backends/encrypted-json"
import { EncryptionUnavailableError, InvalidNamespaceDataError } from "../errors"

interface ApiKey extends Record<string, unknown> {
  id: string
  provider: string
  token: string
}

const tempDir = () => mkdtemp(path.join(tmpdir(), "synapse-encrypted-"))

/**
 * Trivial deterministic "encryption": XOR with a fixed byte. NOT secure — only
 * here to give the backend a real round-trippable transform in tests so we can
 * assert that the on-disk bytes are NOT the plaintext.
 */
function makeFakeSafeStorage(available = true): SafeStorage {
  const KEY = 0x5a
  return {
    isEncryptionAvailable: () => available,
    encryptString(plaintext: string) {
      const buf = Buffer.from(plaintext, "utf8")
      const out = Buffer.alloc(buf.length)
      for (let i = 0; i < buf.length; i++) out[i] = buf[i]! ^ KEY
      return out
    },
    decryptString(cipher: Buffer) {
      const out = Buffer.alloc(cipher.length)
      for (let i = 0; i < cipher.length; i++) out[i] = cipher[i]! ^ KEY
      return out.toString("utf8")
    },
  }
}

describe("EncryptedJsonNamespace (T2.3)", () => {
  it("migrates a legacy plaintext JSON envelope into encrypted storage", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "secrets.bin")
    const legacyFile = path.join(dir, "secrets.json")
    try {
      await writeFile(legacyFile, JSON.stringify({
        schemaVersion: 1,
        singleton: null,
        items: {
          k1: { id: "k1", provider: "anthropic", token: "sk-legacy-token" },
        },
      }))
      const ns = new EncryptedJsonNamespace<ApiKey>({
        name: "secrets",
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: file,
        legacyPlaintextFilePath: legacyFile,
        safeStorage: makeFakeSafeStorage(),
      })

      expect(await ns.get("k1")).toEqual({
        id: "k1",
        provider: "anthropic",
        token: "sk-legacy-token",
      })
      await expect(stat(legacyFile)).rejects.toMatchObject({ code: "ENOENT" })
      const onDisk = await readFile(file)
      expect(onDisk.toString("utf8")).not.toContain("sk-legacy-token")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("keeps a legacy plaintext file untouched when encrypted storage already exists", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "secrets.bin")
    const legacyFile = path.join(dir, "secrets.json")
    try {
      const existing = new EncryptedJsonNamespace<ApiKey>({
        name: "secrets",
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: file,
        safeStorage: makeFakeSafeStorage(),
      })
      await existing.setSingleton({ id: "encrypted", provider: "anthropic", token: "sk-encrypted" })
      await writeFile(legacyFile, JSON.stringify({
        schemaVersion: 1,
        singleton: { id: "legacy", provider: "openai", token: "sk-legacy" },
        items: {},
      }))

      const ns = new EncryptedJsonNamespace<ApiKey>({
        name: "secrets",
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: file,
        legacyPlaintextFilePath: legacyFile,
        safeStorage: makeFakeSafeStorage(),
      })

      expect(await ns.getSingleton()).toEqual({
        id: "encrypted",
        provider: "anthropic",
        token: "sk-encrypted",
      })
      await expect(stat(legacyFile)).resolves.toBeDefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("singleton roundtrip via fake safeStorage; on-disk bytes differ from plaintext", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "secrets.bin")
    try {
      const ns = new EncryptedJsonNamespace<ApiKey>({
        name: "secrets",
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: file,
        safeStorage: makeFakeSafeStorage(),
      })
      await ns.setSingleton({ id: "k1", provider: "anthropic", token: "sk-real-token-VALUE" })

      const onDisk = await readFile(file)
      expect(onDisk.toString("utf8")).not.toContain("sk-real-token-VALUE")
      expect(onDisk.toString("utf8")).not.toContain("anthropic")

      const ns2 = new EncryptedJsonNamespace<ApiKey>({
        name: "secrets",
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: file,
        safeStorage: makeFakeSafeStorage(),
      })
      expect(await ns2.getSingleton()).toEqual({
        id: "k1",
        provider: "anthropic",
        token: "sk-real-token-VALUE",
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("upsert/list/remove roundtrip emits events and stays encrypted on disk", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "secrets.bin")
    try {
      const ns = new EncryptedJsonNamespace<ApiKey>({
        name: "secrets",
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: file,
        safeStorage: makeFakeSafeStorage(),
      })
      const events: string[] = []
      ns.onChange((e) => events.push(`${e.kind}:${e.id ?? ""}`))

      await ns.upsert({ id: "k1", provider: "anthropic", token: "sk-AAA" })
      await ns.upsert({ id: "k2", provider: "openai", token: "sk-BBB" })
      expect(await ns.list()).toHaveLength(2)
      const onDisk = await readFile(file)
      expect(onDisk.toString("utf8")).not.toContain("sk-AAA")
      expect(onDisk.toString("utf8")).not.toContain("sk-BBB")

      await ns.remove("k1")
      expect(await ns.get("k1")).toBeNull()
      expect(events).toEqual(["upsert:k1", "upsert:k2", "remove:k1"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("preserves concurrent collection writes against a cached envelope", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "secrets.bin")
    try {
      const ns = new EncryptedJsonNamespace<ApiKey>({
        name: "secrets",
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: file,
        safeStorage: makeFakeSafeStorage(),
      })
      expect(await ns.list()).toEqual([])

      await Promise.all([
        ns.upsert({ id: "k1", provider: "anthropic", token: "sk-AAA" }),
        ns.upsert({ id: "k2", provider: "openai", token: "sk-BBB" }),
      ])

      expect(await ns.list()).toEqual([
        { id: "k1", provider: "anthropic", token: "sk-AAA" },
        { id: "k2", provider: "openai", token: "sk-BBB" },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("keeps cached collection state unchanged when encrypted persistence fails", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "secrets.bin")
    try {
      let failEncrypt = false
      const safeStorage = makeFakeSafeStorage()
      const ns = new EncryptedJsonNamespace<ApiKey>({
        name: "secrets",
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: file,
        safeStorage: {
          ...safeStorage,
          encryptString(plaintext) {
            if (failEncrypt) throw new Error("disk full")
            return safeStorage.encryptString(plaintext)
          },
        },
      })
      await ns.upsert({ id: "k1", provider: "anthropic", token: "sk-AAA" })
      failEncrypt = true

      await expect(
        ns.upsert({ id: "k2", provider: "openai", token: "sk-BBB" }),
      ).rejects.toThrow("disk full")

      expect(await ns.get("k2")).toBeNull()
      expect(await ns.list()).toEqual([{ id: "k1", provider: "anthropic", token: "sk-AAA" }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("keeps cached singleton state unchanged when encrypted persistence fails", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "secrets.bin")
    try {
      let failEncrypt = false
      const safeStorage = makeFakeSafeStorage()
      const ns = new EncryptedJsonNamespace<ApiKey>({
        name: "secrets",
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: file,
        safeStorage: {
          ...safeStorage,
          encryptString(plaintext) {
            if (failEncrypt) throw new Error("disk full")
            return safeStorage.encryptString(plaintext)
          },
        },
      })
      await ns.setSingleton({ id: "k1", provider: "anthropic", token: "sk-AAA" })
      failEncrypt = true

      await expect(
        ns.setSingleton({ id: "k2", provider: "openai", token: "sk-BBB" }),
      ).rejects.toThrow("disk full")

      expect(await ns.getSingleton()).toEqual({ id: "k1", provider: "anthropic", token: "sk-AAA" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("throws EncryptionUnavailableError when safeStorage reports unavailable", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "secrets.bin")
    try {
      const ns = new EncryptedJsonNamespace<ApiKey>({
        name: "secrets",
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: file,
        safeStorage: makeFakeSafeStorage(false),
      })
      await expect(ns.setSingleton({ id: "k1", provider: "x", token: "y" })).rejects.toBeInstanceOf(
        EncryptionUnavailableError,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("returns null on getSingleton for fresh namespace without touching safeStorage", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "secrets.bin")
    try {
      let calls = 0
      const ss: SafeStorage = {
        isEncryptionAvailable() {
          calls++
          return true
        },
        encryptString(s) {
          return Buffer.from(s)
        },
        decryptString(b) {
          return b.toString()
        },
      }
      const ns = new EncryptedJsonNamespace<ApiKey>({
        name: "secrets",
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: file,
        safeStorage: ss,
      })
      expect(await ns.getSingleton()).toBeNull()
      // Backend must NOT call isEncryptionAvailable for empty-file shortcut.
      expect(calls).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("throws InvalidNamespaceDataError when ciphertext decrypts to garbage", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "secrets.bin")
    try {
      // Write garbage that the fake "encryption" cannot recover into valid JSON.
      await writeFile(file, Buffer.from([0xff, 0xfe, 0xfd]))
      const ns = new EncryptedJsonNamespace<ApiKey>({
        name: "secrets",
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: file,
        safeStorage: makeFakeSafeStorage(),
      })
      await expect(ns.getSingleton()).rejects.toBeInstanceOf(InvalidNamespaceDataError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("validate hook rejects bad payloads on read", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "secrets.bin")
    try {
      // Manually encrypt an invalid envelope payload.
      const ss = makeFakeSafeStorage()
      const bad = JSON.stringify({
        schemaVersion: 1,
        singleton: { id: "1" }, // missing provider/token
        items: {},
      })
      await writeFile(file, ss.encryptString(bad))
      const ns = new EncryptedJsonNamespace<ApiKey>({
        name: "secrets",
        schemaVersion: 1,
        backend: "encrypted-json",
        filePath: file,
        safeStorage: ss,
        validate: (v): v is ApiKey =>
          typeof v === "object"
          && v !== null
          && typeof (v as ApiKey).provider === "string"
          && typeof (v as ApiKey).token === "string",
      })
      await expect(ns.getSingleton()).rejects.toBeInstanceOf(InvalidNamespaceDataError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
