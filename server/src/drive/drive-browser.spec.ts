import { describe, expect, it } from "vitest"
import {
  buildDriveBrowserItemDto,
  buildDriveBrowserPreview,
  resolveDriveBrowserPreviewKind,
  type DriveBrowserSourceItem,
} from "./drive-browser"

const baseItem: DriveBrowserSourceItem = {
  id: "item-1",
  name: "file.txt",
  type: "file",
  size: "11",
  mimeType: "text/plain",
  updatedAt: "2026-06-07T12:00:00.000Z",
}

describe("drive browser helpers", () => {
  it("classifies html files as source previews", () => {
    expect(resolveDriveBrowserPreviewKind({ ...baseItem, name: "index.html", mimeType: "text/html" })).toBe("html-source")
  })

  it("classifies image mime types as image previews", () => {
    expect(resolveDriveBrowserPreviewKind({ ...baseItem, name: "photo.bin", mimeType: "image/png" })).toBe("image")
  })

  it("falls back to text preview by filename when mime type is missing", () => {
    expect(resolveDriveBrowserPreviewKind({ ...baseItem, name: "notes.md", mimeType: null })).toBe("text")
  })

  it("classifies archives as download only", () => {
    expect(resolveDriveBrowserPreviewKind({ ...baseItem, name: "archive.zip", mimeType: "application/zip" })).toBe("download-only")
  })

  it("adds owner-only visit url for html previews", () => {
    const item = { ...baseItem, id: "child-1", name: "index.html", mimeType: "text/html" }
    const preview = buildDriveBrowserPreview({
      item,
      route: { context: "owner", surface: "standalone", rootItemId: "root-1" },
      text: "<html></html>",
    })

    expect(preview.kind).toBe("html-source")
    expect(preview.visitUrl).toBe("/drive/items/root-1/items/child-1/render")
  })

  it("keeps share html previews as source without visit url", () => {
    const item = { ...baseItem, id: "child-1", name: "index.html", mimeType: "text/html" }
    const preview = buildDriveBrowserPreview({
      item,
      route: { context: "share", surface: "standalone", shareId: "shr-1", rootItemId: "root-1" },
      text: "<html></html>",
    })

    expect(preview.kind).toBe("html-source")
    expect(preview.visitUrl).toBeNull()
  })

  it("builds owner child browser urls", () => {
    const item = buildDriveBrowserItemDto({
      item: { ...baseItem, id: "child-1" },
      route: { context: "owner", surface: "standalone", rootItemId: "root-1" },
    })

    expect(item.browserUrl).toBe("/drive/items/root-1/items/child-1")
    expect(item.downloadUrl).toBe("/drive/items/root-1/items/child-1/download")
  })

  it("builds console child browser urls", () => {
    const item = buildDriveBrowserItemDto({
      item: { ...baseItem, id: "child-1" },
      route: { context: "owner", surface: "console", rootItemId: "root-1" },
    })

    expect(item.browserUrl).toBe("/console/drive/items/root-1/items/child-1")
    expect(item.downloadUrl).toBe("/drive/items/root-1/items/child-1/download")
  })
})
