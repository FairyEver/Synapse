import type { DriveBrowserSnapshotDto } from "@synapse/shared"
import { describe, expect, it } from "vitest"
import {
  renderDriveShareReaderPage,
  renderDriveShareReaderPasswordPage,
  renderDriveShareReaderStatusPage,
} from "./drive-share-reader-page"

describe("Drive share compatibility reader page", () => {
  it("renders sanitized Markdown without a duplicate file heading", () => {
    const html = renderDriveShareReaderPage({
      shareId: "shr_public",
      snapshot: createSnapshot({
        current: { name: "guide.md", previewKind: "markdown" },
        preview: {
          kind: "markdown",
          text: "# Guide",
          html: '<h1 id="guide">Guide</h1><p>Readable body</p>',
          outline: [{ id: "guide", text: "Guide", depth: 1, children: [] }],
        },
      }),
    })

    expect(html.match(/<h1/gmu)).toHaveLength(1)
    expect(html).toContain('<h1 id="guide">Guide</h1>')
    expect(html).toContain('href="/share/shr_public/download"')
    expect(html).not.toContain("<script")
  })

  it("escapes text and reports truncated previews", () => {
    const html = renderDriveShareReaderPage({
      shareId: "shr_public",
      snapshot: createSnapshot({
        current: { name: "<brief>.txt" },
        preview: { text: '<script>alert("x")</script>', truncated: true },
      }),
    })

    expect(html).toContain("&lt;brief&gt;.txt")
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;")
    expect(html).toContain("当前仅显示部分内容")
    expect(html).not.toContain('<script>alert("x")</script>')
  })

  it("renders image and download-only states", () => {
    const imageHtml = renderDriveShareReaderPage({
      shareId: "shr_public",
      snapshot: createSnapshot({
        current: { name: 'photo".png', mimeType: "image/png", previewKind: "image" },
        preview: { kind: "image", text: null, imageUrl: "/share/shr_public/download?asset=1&size=large" },
      }),
    })
    const downloadHtml = renderDriveShareReaderPage({
      shareId: "shr_public",
      snapshot: createSnapshot({
        current: { name: "archive.zip", mimeType: "application/zip", previewKind: "download-only" },
        preview: { kind: "download-only", text: null },
      }),
    })

    expect(imageHtml).toContain('alt="photo&quot;.png"')
    expect(imageHtml).toContain('src="/share/shr_public/download?asset=1&amp;size=large"')
    expect(downloadHtml).toContain("无法在浏览器中预览此文件")
    expect(downloadHtml).toContain("下载文件")
  })

  it("renders folders with reader links, breadcrumbs, and pagination", () => {
    const html = renderDriveShareReaderPage({
      shareId: "shr/folder",
      snapshot: createSnapshot({
        current: { id: "folder-2", name: "资料", type: "folder", previewKind: "download-only", downloadUrl: "/share/shr%2Ffolder/items/folder-2/download" },
        breadcrumbs: [
          { id: "root", name: "根目录", browserUrl: "/share/shr%2Ffolder" },
          { id: "folder-2", name: "资料", browserUrl: "/share/shr%2Ffolder/items/folder-2" },
        ],
        children: [{
          id: "child/file",
          name: "说明.txt",
          type: "file",
          size: "5",
          mimeType: "text/plain",
          updatedAt: "2026-09-11T00:00:00.000Z",
          previewKind: "text",
          browserUrl: "/share/shr%2Ffolder/items/child%2Ffile",
          downloadUrl: "/share/shr%2Ffolder/items/child%2Ffile/download",
        }],
        childrenPage: { offset: 100, limit: 100, hasMore: true, nextOffset: 200 },
        preview: null,
        canDownload: false,
        canZip: true,
      }),
    })

    expect(html).toContain('href="/share/shr%2Ffolder/reader"')
    expect(html).toContain('<a class="reader-entry-link" href="/share/shr%2Ffolder/items/child%2Ffile/reader">说明.txt<span class="reader-entry-meta">文件</span></a>')
    expect(html).toContain('href="/share/shr%2Ffolder/items/folder-2/reader" rel="prev"')
    expect(html).toContain('href="/share/shr%2Ffolder/items/folder-2/reader?childrenOffset=200" rel="next"')
    expect(html).toContain("下载文件夹")
  })

  it("renders password and status pages with legacy-safe markup", () => {
    const passwordHtml = renderDriveShareReaderPasswordPage({ actionPath: '/share/shr"bad/reader', error: true })
    const statusHtml = renderDriveShareReaderStatusPage({ title: "链接已失效", message: "请确认最新链接。" })

    expect(passwordHtml).toContain('action="/share/shr&quot;bad/reader"')
    expect(passwordHtml).toContain('name="password"')
    expect(passwordHtml).toContain("密码不正确")
    expect(statusHtml).toContain("链接已失效")
    expect(statusHtml).not.toMatch(/--[a-z-]+:|@layer|oklch|color-mix|<script/iu)
  })
})

function createSnapshot(overrides: {
  readonly current?: Partial<DriveBrowserSnapshotDto["current"]>
  readonly breadcrumbs?: DriveBrowserSnapshotDto["breadcrumbs"]
  readonly children?: DriveBrowserSnapshotDto["children"]
  readonly childrenPage?: DriveBrowserSnapshotDto["childrenPage"]
  readonly preview?: Partial<NonNullable<DriveBrowserSnapshotDto["preview"]>> | null
  readonly canDownload?: boolean
  readonly canZip?: boolean
} = {}): DriveBrowserSnapshotDto {
  const current: DriveBrowserSnapshotDto["current"] = {
    id: "file-1",
    name: "brief.txt",
    type: "file",
    size: "11",
    mimeType: "text/plain",
    updatedAt: "2026-09-11T00:00:00.000Z",
    previewKind: "text",
    browserUrl: "/share/shr_public",
    downloadUrl: "/share/shr_public/download",
    ...overrides.current,
  }
  const defaultPreview: NonNullable<DriveBrowserSnapshotDto["preview"]> = {
    kind: "text",
    text: "brief",
    html: null,
    outline: null,
    truncated: false,
    imageUrl: null,
    visitUrl: null,
    relativeImages: [],
  }
  return {
    context: "share",
    surface: "standalone",
    current,
    breadcrumbs: overrides.breadcrumbs ?? [{ id: current.id, name: current.name, browserUrl: current.browserUrl }],
    children: overrides.children ?? [],
    childrenPage: overrides.childrenPage,
    preview: overrides.preview === null ? null : { ...defaultPreview, ...overrides.preview },
    edit: null,
    annotation: null,
    canDownload: overrides.canDownload ?? true,
    canZip: overrides.canZip ?? false,
  }
}
