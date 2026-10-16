import { describe, expect, it, vi } from "vitest"
import type { DriveFileReplacePreviewDto, DriveItemDto } from "@synapse/shared"
import { reviewDriveLocalUpload } from "../drive-local-upload-review"
const item = (id: string, name: string, type: "file" | "folder" = "file") => ({ id, name, type } as DriveItemDto)
const preview = { itemId: "remote-md", name: "report.md", localName: "report.md", size: "30", previousSize: "20", versionId: "v1", confirmationToken: "review-1", syncImpacts: [], blockedReason: null } satisfies DriveFileReplacePreviewDto

describe("native upload collision review", () => {
  it("reviews an existing loose file with exact identity and does not reuse a retry token", async () => {
    const api = { list: vi.fn().mockResolvedValue({ items: [item("remote-md", "report.md")], nextOffset: null }), preview: vi.fn().mockResolvedValue(preview) }
    const result = await reviewDriveLocalUpload({ parentId: "parent", items: [{ kind: "file", path: "/report.md", name: "report.md", expectedItemId: "old-id", replacementToken: "stale" }] }, api)
    expect(api.preview).toHaveBeenCalledWith("remote-md", "/report.md")
    expect(result.request.items[0]).toMatchObject({ expectedItemId: "remote-md", replacementToken: "review-1" })
    expect(result.replacements[0]?.preview.versionId).toBe("v1")
  })
  it("walks only selected folder branches, paginates them, and guards the root identity", async () => {
    const list = vi.fn(async (parentId: string | null, offset: number) => parentId === null
      ? { items: offset === 0 ? [item("other", "Other", "folder")] : [item("root", "Docs", "folder")], nextOffset: offset === 0 ? 1 : null }
      : parentId === "root" ? { items: [item("child", "notes", "folder")], nextOffset: null }
      : { items: [item("remote-md", "report.md")], nextOffset: null })
    const result = await reviewDriveLocalUpload({ items: [{ kind: "folder", folderName: "Docs", files: [{ path: "/report.md", relativePath: "notes/report.md" }, { path: "/new.md", relativePath: "notes/new.md" }] }] }, { list, preview: vi.fn().mockResolvedValue(preview) })
    expect(list).toHaveBeenCalledTimes(4)
    expect(list).not.toHaveBeenCalledWith("other", expect.anything())
    expect(result.request.items[0]).toMatchObject({ expectedRootItemId: "root", files: [{ expectedItemId: "remote-md", replacementToken: "review-1" }, { path: "/new.md" }] })
    expect(result.replacements).toHaveLength(1)
  })
  it("guards a new folder and removes obsolete file replacement decisions", async () => {
    const result = await reviewDriveLocalUpload({ items: [{ kind: "folder", folderName: "New", files: [{ path: "/a.md", relativePath: "a.md", expectedItemId: "old", replacementToken: "old-token" }] }] }, { list: vi.fn().mockResolvedValue({ items: [], nextOffset: null }), preview: vi.fn() })
    expect(result.request.items[0]).toMatchObject({ createRootOnly: true })
    expect(result.replacements).toEqual([])
    expect(result.request.items[0]?.kind === "folder" && result.request.items[0].files[0]).not.toHaveProperty("replacementToken")
  })
  it("surfaces sync blockers and rejects same-name type changes before upload", async () => {
    const blocked = await reviewDriveLocalUpload({ items: [{ kind: "file", path: "/report.md", name: "report.md" }] }, { list: vi.fn().mockResolvedValue({ items: [item("remote-md", "report.md")], nextOffset: null }), preview: vi.fn().mockResolvedValue({ ...preview, blockedReason: "本地存在未同步修改" }) })
    expect(blocked.replacements[0]?.preview.blockedReason).toBe("本地存在未同步修改")
    await expect(reviewDriveLocalUpload({ items: [{ kind: "file", path: "/report.md", name: "report.md" }] }, { list: vi.fn().mockResolvedValue({ items: [item("folder", "report.md", "folder")], nextOffset: null }), preview: vi.fn() })).rejects.toThrow("类型不同")
  })
  it("does not guess among legacy duplicates and ignores opposite-kind ordering", async () => {
    const request = { items: [{ kind: "file" as const, path: "/report.md", name: "report.md" }] }
    const api = { list: vi.fn().mockResolvedValue({ items: [item("first", "report.md"), item("second", "report.md")], nextOffset: null }), preview: vi.fn().mockResolvedValue(preview) }
    await expect(reviewDriveLocalUpload(request, api)).rejects.toThrow("多个")
    expect(api.preview).not.toHaveBeenCalled()
    api.list.mockResolvedValueOnce({ items: [item("folder", "report.md", "folder"), item("remote-md", "report.md")], nextOffset: null })
    await reviewDriveLocalUpload(request, api)
    expect(api.preview).toHaveBeenCalledWith("remote-md", "/report.md")
  })

})
