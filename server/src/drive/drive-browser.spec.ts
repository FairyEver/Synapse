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

  it("classifies markdown files by extension and mime type", () => {
    expect(resolveDriveBrowserPreviewKind({ ...baseItem, name: "notes.md", mimeType: null })).toBe("markdown")
    expect(resolveDriveBrowserPreviewKind({ ...baseItem, name: "guide.markdown", mimeType: null })).toBe("markdown")
    expect(resolveDriveBrowserPreviewKind({ ...baseItem, name: "upload.bin", mimeType: "text/markdown" })).toBe("markdown")
    expect(resolveDriveBrowserPreviewKind({ ...baseItem, name: "legacy.bin", mimeType: "text/x-markdown" })).toBe("markdown")
  })

  it("falls back to text preview by filename when mime type is missing", () => {
    expect(resolveDriveBrowserPreviewKind({ ...baseItem, name: "notes.txt", mimeType: null })).toBe("text")
  })

  it("classifies archives as download only", () => {
    expect(resolveDriveBrowserPreviewKind({ ...baseItem, name: "archive.zip", mimeType: "application/zip" })).toBe("download-only")
  })

  it("adds owner visit url for html previews", () => {
    const item = { ...baseItem, id: "child-1", name: "index.html", mimeType: "text/html" }
    const preview = buildDriveBrowserPreview({
      item,
      route: { context: "owner", surface: "standalone" },
      text: "<html></html>",
    })

    expect(preview.kind).toBe("html-source")
    expect(preview.visitUrl).toBe("/drive/items/child-1/render")
  })

  it("adds share visit url for html previews", () => {
    const item = { ...baseItem, id: "child-1", name: "index.html", mimeType: "text/html" }
    const preview = buildDriveBrowserPreview({
      item,
      route: { context: "share", surface: "standalone", shareId: "shr-1", rootItemId: "root-1" },
      text: "<html></html>",
    })

    expect(preview.kind).toBe("html-source")
    expect(preview.visitUrl).toBe("/share/shr-1/items/child-1/render")
  })

  it("builds owner markdown previews with rendered html instead of visit urls", () => {
    const item = { ...baseItem, id: "child-1", name: "notes.md", mimeType: "text/markdown" }
    const preview = buildDriveBrowserPreview({
      item,
      route: { context: "owner", surface: "standalone" },
      text: "# Notes",
      html: "<h1>Notes</h1>",
    })

    expect(preview.kind).toBe("markdown")
    expect(preview.text).toBe("# Notes")
    expect(preview.html).toBe("<h1>Notes</h1>")
    expect(preview.visitUrl).toBeNull()
  })

  it("builds share markdown previews with rendered html", () => {
    const item = { ...baseItem, id: "child-1", name: "notes.md", mimeType: "text/markdown" }
    const preview = buildDriveBrowserPreview({
      item,
      route: { context: "share", surface: "standalone", shareId: "shr-1", rootItemId: "root-1" },
      text: "# Notes",
      html: "<h1>Notes</h1>",
    })

    expect(preview.kind).toBe("markdown")
    expect(preview.html).toBe("<h1>Notes</h1>")
    expect(preview.visitUrl).toBeNull()
  })

  it("builds owner item browser urls", () => {
    const item = buildDriveBrowserItemDto({
      item: { ...baseItem, id: "child-1" },
      route: { context: "owner", surface: "standalone" },
    })

    expect(item.browserUrl).toBe("/drive/items/child-1")
    expect(item.downloadUrl).toBe("/drive/items/child-1/download")
  })

  it("builds console folder browser urls", () => {
    const item = buildDriveBrowserItemDto({
      item: { ...baseItem, id: "child-1", type: "folder" },
      route: { context: "owner", surface: "console" },
    })

    expect(item.browserUrl).toBe("/console/drive/folders/child-1")
    expect(item.downloadUrl).toBe("/drive/items/child-1/download")
  })

  it("builds console file browser urls as console item links", () => {
    const item = buildDriveBrowserItemDto({
      item: { ...baseItem, id: "child-1", type: "file" },
      route: { context: "owner", surface: "console" },
    })

    expect(item.browserUrl).toBe("/console/drive/items/child-1?surface=console")
    expect(item.downloadUrl).toBe("/drive/items/child-1/download")
  })
})
