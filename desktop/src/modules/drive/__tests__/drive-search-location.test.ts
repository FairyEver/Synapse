import { describe, expect, it, vi } from "vitest"
import type { DriveItemDto } from "@synapse/shared"
import { resolveDriveSearchLocation } from "../drive-search-location"
import { driveSearchHighlightParts } from "../drive-search-highlight"

const item = (id: string, parentId: string | null = null, type: "file" | "folder" = "file"): DriveItemDto => ({ id, parentId, type, name: id, size: "0", mimeType: null, storageStatus: "active", shared: false, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z" })
describe("Drive search result identity", () => {
  it("revalidates the current parent chain and loads a target beyond the first 100 items", async () => {
    const reader = { get: vi.fn(async ({ itemId }) => itemId === "target" ? item("target", "moved-folder") : item("moved-folder", null, "folder")),
      list: vi.fn().mockResolvedValueOnce({ items: Array.from({ length: 100 }, (_, index) => item(`before-${index}`, "moved-folder")), page: { offset: 0, limit: 100, hasMore: true, nextOffset: 100 } })
        .mockResolvedValueOnce({ items: [item("target", "moved-folder")], page: { offset: 100, limit: 100, hasMore: false, nextOffset: null } }) }
    const result = await resolveDriveSearchLocation("target", false, reader, () => true)
    expect(result?.folderId).toBe("moved-folder"); expect(result?.items).toHaveLength(101)
    expect(result?.path).toEqual([{ id: null, name: "根目录" }, { id: "moved-folder", name: "moved-folder" }])
    expect(reader.list).toHaveBeenLastCalledWith({ parentId: "moved-folder", offset: 100, limit: 100 })
  })
  it("stops cancelled location reads and rejects cycles or vanished targets", async () => {
    const reader = { get: vi.fn(async () => item("target", "target")), list: vi.fn(async () => []) }
    await expect(resolveDriveSearchLocation("target", false, reader, () => false)).resolves.toBeNull()
    expect(reader.list).not.toHaveBeenCalled()
    await expect(resolveDriveSearchLocation("target", false, reader, () => true)).rejects.toThrow("层级无效")
    reader.get.mockResolvedValue(item("target"))
    await expect(resolveDriveSearchLocation("target", false, reader, () => true)).rejects.toThrow("位置已变化")
  })
  it("highlights normalized graphemes without splitting original Unicode characters", () => {
    expect(driveSearchHighlightParts("Ｔｅｓｔ e\u0301 ﬃ.md", "test é ffi")).toEqual([
      { value: "Ｔｅｓｔ", match: true }, { value: " ", match: false }, { value: "e\u0301", match: true }, { value: " ", match: false }, { value: "ﬃ", match: true }, { value: ".md", match: false },
    ])
  })
})
