import { describe, expect, it, vi } from "vitest"
import { createDriveCapabilityDispatcher } from "../drive-dispatcher"

type DriveDispatcherDeps = Parameters<typeof createDriveCapabilityDispatcher>[0]
type DriveAccountService = DriveDispatcherDeps["accountService"]
type DriveItem = Awaited<ReturnType<DriveAccountService["listDriveItems"]>>[number]

describe("createDriveCapabilityDispatcher", () => {
  it("lists Drive items under root by default", async () => {
    const accountService = createAccountService({
      listDriveItems: vi.fn(async () => [driveItem({ id: "item-1", name: "a.txt" })]),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.item.list", {}, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: [driveItem({ id: "item-1", name: "a.txt" })],
      total: 1,
    })
    expect(accountService.listDriveItems).toHaveBeenCalledWith(null)
  })

  it("uploads a local file without returning the presigned URL", async () => {
    const accountService = createAccountService()
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      fileSystem: {
        stat: vi.fn(async () => ({ isFile: () => true, isDirectory: () => false, size: 4 })),
        readFile: vi.fn(async () => Buffer.from("test")),
        readdir: vi.fn(),
      } as unknown as DriveDispatcherDeps["fileSystem"],
      fetch: vi.fn(async () => ({ ok: true }) as Response),
    })

    const result = await dispatcher.dispatch("drive.file.upload", {
      filePath: "/tmp/report.md",
    }, { source: "mcp-stdio" })

    expect(result).toEqual({ ok: true, data: driveItem({ id: "item-1", name: "report.md" }) })
    expect(JSON.stringify(result)).not.toContain("X-Amz-Signature")
    expect(accountService.prepareDriveUpload).toHaveBeenCalledWith({
      parentId: null,
      name: "report.md",
      size: "4",
      mimeType: null,
    })
  })
})

function createAccountService(overrides: Partial<DriveAccountService> = {}): DriveAccountService {
  return {
    listDriveItems: vi.fn(async () => []),
    prepareDriveUpload: vi.fn(async () => ({
      sessionId: "session-1",
      item: { id: "item-1", name: "report.md" },
      upload: {
        method: "PUT",
        url: "https://cos.example/upload?X-Amz-Signature=secret",
        expiresAt: "2026-06-07T00:00:00.000Z",
        headers: {},
      },
    })),
    prepareDriveFolderUpload: vi.fn(),
    completeDriveUpload: vi.fn(async () => driveItem({ id: "item-1", name: "report.md" })),
    cancelDriveUpload: vi.fn(async () => ({ ok: true })),
    createDriveFolder: vi.fn(),
    moveDriveItem: vi.fn(),
    deleteDriveItem: vi.fn(),
    shareDriveItem: vi.fn(),
    disableDriveShare: vi.fn(),
    getDriveUsage: vi.fn(),
    ...overrides,
  } as unknown as DriveAccountService
}

function driveItem(overrides: Partial<DriveItem>): DriveItem {
  return {
    id: "item-1",
    parentId: null,
    type: "file",
    name: "report.md",
    size: "4",
    mimeType: null,
    storageStatus: "active",
    shared: false,
    activeShareId: null,
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    ...overrides,
  }
}
