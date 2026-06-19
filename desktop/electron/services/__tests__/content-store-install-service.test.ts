import { createHash } from "node:crypto"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { deflateRawSync } from "node:zlib"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ContentStoreInstallManifest } from "@synapse/shared"

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), `synapse-content-store-${name}`),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }),
}))

import {
  ContentStoreInstallService,
  type ContentStoreInstallAccountPort,
} from "../content-store-install-service"
import { AccountAuthenticationRequiredError } from "../account-service"

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-store-install-"))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("ContentStoreInstallService", () => {
  it("returns a typed unauthenticated state without making a request", async () => {
    const account = createAccount({ state: { status: "unauthenticated" } })
    const service = new ContentStoreInstallService({
      accountService: account,
      clientIdStore: { getOrCreate: vi.fn() },
      tempRoot: await createTempRoot(),
    })

    await expect(service.resolveInstallSession("session-1")).resolves.toEqual({
      status: "unauthenticated",
    })
    expect(account.fetchAuthenticated).not.toHaveBeenCalled()
  })

  it("streams, verifies, extracts, and exposes only a controlled prepared source", async () => {
    const packageBytes = createPackage()
    const account = createAccount({
      responses: [
        jsonResponse(createResolvedSession(packageBytes)),
        chunkedResponse(packageBytes),
      ],
    })
    const tempRoot = await createTempRoot()
    const service = new ContentStoreInstallService({
      accountService: account,
      clientIdStore: { getOrCreate: vi.fn() },
      createId: () => "prepared-1",
      tempRoot,
    })

    const result = await service.prepare("session-1")

    expect(result).toEqual({
      status: "prepared",
      source: {
        id: "prepared-1",
        contentId: "content-1",
        versionId: "version-1",
        type: "skill",
        title: "Store Skill",
        mainFile: "content/SKILL.md",
        mainContent: "# Store Skill\n",
        files: [
          {
            kind: "text",
            path: "content/SKILL.md",
            size: Buffer.byteLength("# Store Skill\n"),
          },
          {
            kind: "binary",
            path: "content/assets/icon.bin",
            size: 4,
          },
        ],
      },
    })
    expect(JSON.stringify(result)).not.toContain(tempRoot)

    await expect(service.readPreparedRule("prepared-1", "content-1")).rejects.toThrow(
      "prepared source type does not match",
    )
    const stagedRoot = path.join(await createTempRoot(), "staged")
    await service.copyPreparedSkill("prepared-1", "content-1", stagedRoot)
    await expect(readFile(path.join(stagedRoot, "SKILL.md"), "utf8")).resolves.toBe("# Store Skill\n")
    await expect(readFile(path.join(stagedRoot, "assets", "icon.bin"))).resolves.toEqual(
      Buffer.from([0, 1, 2, 3]),
    )
    await expect(service.readPreparedSkill("prepared-1", "content-1")).resolves.toMatchObject({
      id: "content-1",
      type: "skill",
      content: "# Store Skill\n",
      attachments: [{ originalName: "assets/icon.bin", size: 4 }],
    })
    expect(account.fetchAuthenticated).toHaveBeenNthCalledWith(
      1,
      "/content-store/install-sessions/session-1",
      expect.objectContaining({ method: "GET" }),
      "安装信息加载失败。",
    )
    expect(account.fetchAuthenticated).toHaveBeenNthCalledWith(
      2,
      "/content-store/install-sessions/session-1/package",
      expect.objectContaining({ method: "GET" }),
      "安装包下载失败。",
    )
  })

  it("checks the package hash before parsing the archive and cleans failed downloads", async () => {
    const tempRoot = await createTempRoot()
    const invalidZip = Buffer.from("not a zip")
    const account = createAccount({
      responses: [
        jsonResponse({
          ...createResolvedSession(invalidZip),
          packageSha256: "0".repeat(64),
        }),
        chunkedResponse(invalidZip),
      ],
    })
    const service = new ContentStoreInstallService({
      accountService: account,
      clientIdStore: { getOrCreate: vi.fn() },
      tempRoot,
    })

    await expect(service.prepare("session-1")).rejects.toThrow("package SHA-256 does not match")
    await expect(readdir(tempRoot)).resolves.toEqual([])
  })

  it.each([
    {
      name: "path traversal",
      package: () => createPackage({
        manifestPatch: {
          files: [manifestFile("../escape.md", Buffer.from("escape"), "text")],
        },
        payloadEntries: [{ name: "../escape.md", bytes: Buffer.from("escape") }],
      }),
      message: "unsafe ZIP entry path",
    },
    {
      name: "backslash path",
      package: () => createPackage({
        manifestPatch: {
          files: [manifestFile("content\\SKILL.md", Buffer.from("bad"), "text")],
        },
        payloadEntries: [{ name: "content\\SKILL.md", bytes: Buffer.from("bad") }],
      }),
      message: "unsafe ZIP entry path",
    },
    {
      name: "Windows-hostile path",
      package: () => createPackage({
        payloadEntries: [
          { name: "content/SKILL.md", bytes: Buffer.from("# Store Skill\n") },
          { name: "content/bad?name.md", bytes: Buffer.from("bad") },
        ],
      }),
      message: "unsafe ZIP entry path",
    },
    {
      name: "duplicate entry",
      package: () => createPackage({
        extraEntries: [{ name: "content/SKILL.md", bytes: Buffer.from("# duplicate\n") }],
      }),
      message: "duplicate ZIP entry",
    },
    {
      name: "undeclared payload",
      package: () => createPackage({
        extraEntries: [{ name: "content/extra.txt", bytes: Buffer.from("extra") }],
      }),
      message: "undeclared ZIP payload",
    },
    {
      name: "file hash mismatch",
      package: () => createPackage({
        manifestPatch: {
          files: [
            {
              ...manifestFile("content/SKILL.md", Buffer.from("# Store Skill\n"), "text"),
              sha256: "f".repeat(64),
            },
            manifestFile("content/assets/icon.bin", Buffer.from([0, 1, 2, 3]), "binary"),
          ],
        },
      }),
      message: "file SHA-256 does not match",
    },
    {
      name: "wrong main file",
      package: () => createPackage({
        manifestPatch: { mainFile: "content/RULE.md" as const },
      }),
      message: "mainFile does not match",
    },
  ])("rejects $name and cleans temporary data", async ({ package: buildPackage, message }) => {
    const packageBytes = buildPackage()
    const tempRoot = await createTempRoot()
    const service = new ContentStoreInstallService({
      accountService: createAccount({
        responses: [
          jsonResponse(createResolvedSession(packageBytes)),
          chunkedResponse(packageBytes),
        ],
      }),
      clientIdStore: { getOrCreate: vi.fn() },
      tempRoot,
    })

    await expect(service.prepare("session-1")).rejects.toThrow(message)
    await expect(readdir(tempRoot)).resolves.toEqual([])
  })

  it("enforces archive entry and size limits before extraction", async () => {
    const packageBytes = createPackage()
    const tempRoot = await createTempRoot()
    const service = new ContentStoreInstallService({
      accountService: createAccount({
        responses: [
          jsonResponse(createResolvedSession(packageBytes)),
          chunkedResponse(packageBytes),
        ],
      }),
      clientIdStore: { getOrCreate: vi.fn() },
      limits: {
        maxCompressedBytes: packageBytes.length,
        maxEntries: 2,
        maxFileBytes: 1024,
        maxManifestBytes: 1024,
        maxUncompressedBytes: 1024,
      },
      tempRoot,
    })

    await expect(service.prepare("session-1")).rejects.toThrow("too many ZIP entries")
    await expect(readdir(tempRoot)).resolves.toEqual([])
  })

  it("returns unauthenticated and cleans temporary data when package download loses auth", async () => {
    const packageBytes = createPackage()
    const tempRoot = await createTempRoot()
    const service = new ContentStoreInstallService({
      accountService: createAccount({
        responses: [jsonResponse(createResolvedSession(packageBytes))],
        responseErrors: [new AccountAuthenticationRequiredError()],
      }),
      clientIdStore: { getOrCreate: vi.fn() },
      tempRoot,
    })

    await expect(service.prepare("session-1")).resolves.toEqual({ status: "unauthenticated" })
    await expect(readdir(tempRoot)).resolves.toEqual([])
  })

  it("bounds deflate output by declared uncompressed size", async () => {
    const packageBytes = createPackage({
      forgedUncompressedSize: Buffer.byteLength("# Store Skill\n") - 1,
    })
    const tempRoot = await createTempRoot()
    const service = new ContentStoreInstallService({
      accountService: createAccount({
        responses: [
          jsonResponse(createResolvedSession(packageBytes)),
          chunkedResponse(packageBytes),
        ],
      }),
      clientIdStore: { getOrCreate: vi.fn() },
      tempRoot,
    })

    await expect(service.prepare("session-1")).rejects.toThrow()
    await expect(readdir(tempRoot)).resolves.toEqual([])
  })

  it("records completion with the stable client id and releases the prepared source", async () => {
    const packageBytes = createPackage({ type: "rule" })
    const account = createAccount({
      responses: [
        jsonResponse(createResolvedSession(packageBytes, "rule")),
        chunkedResponse(packageBytes),
        jsonResponse({ ok: true }),
      ],
    })
    const getOrCreate = vi.fn().mockResolvedValue("client-stable")
    const service = new ContentStoreInstallService({
      accountService: account,
      clientIdStore: { getOrCreate },
      createId: () => "prepared-rule",
      tempRoot: await createTempRoot(),
    })

    const prepared = await service.prepare("session-1")
    expect(prepared.status).toBe("prepared")
    await expect(service.readPreparedRule("prepared-rule", "content-1")).resolves.toBe("# Store Rule\n")
    await expect(service.recordComplete("session-1")).rejects.toThrow("has not been installed")
    await service.markPreparedInstalled("prepared-rule", "content-1")

    await expect(service.recordComplete("session-1")).resolves.toEqual({ ok: true })

    expect(getOrCreate).toHaveBeenCalledTimes(1)
    expect(account.fetchAuthenticated).toHaveBeenLastCalledWith(
      "/content-store/install-sessions/session-1/complete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ clientInstanceId: "client-stable" }),
      }),
      "安装完成记录失败。",
    )
    await expect(service.readPreparedRule("prepared-rule", "content-1")).rejects.toThrow(
      "prepared source is unavailable",
    )
  })

  it("releases a prepared package after an in-flight install window is closed", async () => {
    const packageBytes = createPackage()
    const tempRoot = await createTempRoot()
    const service = new ContentStoreInstallService({
      accountService: createAccount({
        responses: [
          jsonResponse(createResolvedSession(packageBytes)),
          chunkedResponse(packageBytes),
        ],
      }),
      clientIdStore: { getOrCreate: vi.fn() },
      createId: () => "prepared-1",
      tempRoot,
    })

    await expect(service.prepare("session-1")).resolves.toMatchObject({
      status: "prepared",
      source: { id: "prepared-1" },
    })
    await expect(readdir(tempRoot)).resolves.toHaveLength(1)

    await service.beginPreparedInstall("prepared-1", "content-1")
    await service.cleanupIfIdle("session-1")

    await expect(readdir(tempRoot)).resolves.toHaveLength(1)
    await expect(service.readPreparedSkill("prepared-1", "content-1")).resolves.toMatchObject({
      id: "content-1",
    })

    await service.endPreparedInstall("prepared-1", "content-1")

    await expect(readdir(tempRoot)).resolves.toEqual([])
    await expect(service.readPreparedSkill("prepared-1", "content-1")).rejects.toThrow(
      "prepared source is unavailable",
    )
  })
})

function createAccount(input: {
  readonly responseErrors?: Error[]
  readonly responses?: Response[]
  readonly state?: ReturnType<ContentStoreInstallAccountPort["getState"]>
} = {}): ContentStoreInstallAccountPort & { fetchAuthenticated: ReturnType<typeof vi.fn> } {
  const responseErrors = [...(input.responseErrors ?? [])]
  const responses = [...(input.responses ?? [])]
  return {
    getState: () => input.state ?? {
      status: "authenticated",
      connectivity: "online",
      profile: {
        user: { id: "user-1", email: "user@example.com", displayName: "User", status: "active" },
        teams: [],
        syncedAt: "2026-06-10T00:00:00.000Z",
      },
    },
    fetchAuthenticated: vi.fn(async () => {
      const error = responseErrors.shift()
      if (error) throw error
      const response = responses.shift()
      if (!response) throw new Error("Missing test response")
      return response
    }),
  }
}

function createResolvedSession(packageBytes: Buffer, type: "skill" | "rule" = "skill") {
  return {
    id: "session-1",
    contentId: "content-1",
    versionId: "version-1",
    type,
    title: type === "skill" ? "Store Skill" : "Store Rule",
    packageSha256: sha256(packageBytes),
    packageSize: String(packageBytes.length),
    expiresAt: "2026-06-10T01:00:00.000Z",
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

function chunkedResponse(bytes: Buffer): Response {
  const midpoint = Math.max(1, Math.floor(bytes.length / 2))
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, midpoint))
      controller.enqueue(bytes.subarray(midpoint))
      controller.close()
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/zip" },
  })
}

function createPackage(options: {
  readonly forgedUncompressedSize?: number
  readonly type?: "skill" | "rule"
  readonly manifestPatch?: Partial<ContentStoreInstallManifest>
  readonly payloadEntries?: ZipEntryInput[]
  readonly extraEntries?: ZipEntryInput[]
} = {}): Buffer {
  const type = options.type ?? "skill"
  const mainPath = type === "skill" ? "content/SKILL.md" : "content/RULE.md"
  const mainBytes = Buffer.from(type === "skill" ? "# Store Skill\n" : "# Store Rule\n")
  const defaultPayloadEntries: ZipEntryInput[] = type === "skill"
    ? [
        { name: mainPath, bytes: mainBytes },
        { name: "content/assets/icon.bin", bytes: Buffer.from([0, 1, 2, 3]), method: 0 },
      ]
    : [{ name: mainPath, bytes: mainBytes }]
  const payloadEntries = options.payloadEntries ?? defaultPayloadEntries
  const manifest: ContentStoreInstallManifest = {
    schemaVersion: 1,
    contentId: "content-1",
    versionId: "version-1",
    type,
    title: type === "skill" ? "Store Skill" : "Store Rule",
    mainFile: mainPath,
    files: payloadEntries.map((entry) => manifestFile(
      entry.name,
      entry.bytes,
      entry.name.endsWith(".md") ? "text" : "binary",
    )),
    ...options.manifestPatch,
  }

  return createZip([
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
    ...payloadEntries,
    ...(options.extraEntries ?? []),
  ], options.forgedUncompressedSize)
}

function manifestFile(
  filePath: string,
  bytes: Buffer,
  kind: "text" | "binary",
): ContentStoreInstallManifest["files"][number] {
  return {
    path: filePath,
    size: bytes.length,
    sha256: sha256(bytes),
    kind,
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

type ZipEntryInput = {
  readonly name: string
  readonly bytes: Buffer
  readonly method?: 0 | 8
}

function createZip(entries: readonly ZipEntryInput[], forgedUncompressedSize?: number): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const method = entry.method ?? 8
    const compressed = method === 0 ? entry.bytes : deflateRawSync(entry.bytes)
    const crc = crc32(entry.bytes)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    const uncompressedSize = forgedUncompressedSize ?? entry.bytes.length
    local.writeUInt32LE(uncompressedSize, 22)
    local.writeUInt16LE(name.length, 26)
    localParts.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0314, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(uncompressedSize, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.length + name.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, centralDirectory, end])
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
