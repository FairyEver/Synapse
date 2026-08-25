import { describe, expect, it } from "vitest"
import { DRIVE_ANNOTATION_QUOTE_EXACT_MAX_LENGTH } from "@synapse/shared"
import {
  isCommentableMarkdownItem,
  parseDriveAnnotationCreateBody,
  resolveDriveAnnotationTarget,
} from "./drive-annotation-target"

describe("drive annotation target helpers", () => {
  it("allows only .md files for comment creation", () => {
    expect(isCommentableMarkdownItem({ name: "notes.md", type: "file", mimeType: "text/markdown" })).toBe(true)
    expect(isCommentableMarkdownItem({ name: "NOTES.MD", type: "file", mimeType: null })).toBe(true)
    expect(isCommentableMarkdownItem({ name: "notes.markdown", type: "file", mimeType: null })).toBe(false)
    expect(isCommentableMarkdownItem({ name: "notes.mdx", type: "file", mimeType: null })).toBe(false)
    expect(isCommentableMarkdownItem({ name: "upload.bin", type: "file", mimeType: "text/markdown" })).toBe(false)
    expect(isCommentableMarkdownItem({ name: "folder.md", type: "folder", mimeType: null })).toBe(false)
    expect(isCommentableMarkdownItem({ name: "notes.txt", type: "file", mimeType: "text/plain" })).toBe(false)
  })

  it("validates text range create bodies", () => {
    const parsed = parseDriveAnnotationCreateBody({
      targetKind: "textRange",
      target: {
        schemaVersion: 1,
        kind: "textRange",
        surface: "markdownRenderedText",
        range: { start: 2, end: 5 },
        quote: { exact: "abc", prefix: "x", suffix: "y" },
      },
      body: "Looks good",
    })

    expect(parsed.body).toBe("Looks good")
    expect(parsed.target.kind).toBe("textRange")
    if (parsed.target.kind === "textRange") expect(parsed.target.range).toEqual({ start: 2, end: 5 })
  })

  it("validates image create bodies", () => {
    const parsed = parseDriveAnnotationCreateBody({
      targetKind: "image",
      target: {
        schemaVersion: 1,
        kind: "image",
        surface: "markdownRenderedImage",
        imageId: "mdimg_1",
        resourceKey: "file:asset_1",
        source: { startOffset: 2, endOffset: 18 },
        snapshot: { src: "/files/asset_1", alt: "", title: null },
        blockHint: { blockId: "block-1", blockIndex: 0, imageIndex: 0, headingPath: [] },
      },
      body: "图片评论",
    })

    expect(parsed).toMatchObject({ targetKind: "image", target: { imageId: "mdimg_1" }, body: "图片评论" })
  })

  it("rejects empty comments and collapsed ranges in first-version UI input", () => {
    expect(() => parseDriveAnnotationCreateBody({
      targetKind: "textRange",
      target: {
        schemaVersion: 1,
        kind: "textRange",
        surface: "markdownRenderedText",
        range: { start: 4, end: 4 },
        quote: { exact: "", prefix: "abc", suffix: "def" },
      },
      body: "ok",
    })).toThrow("评论位置无效。")

    expect(() => parseDriveAnnotationCreateBody({
      targetKind: "textRange",
      target: {
        schemaVersion: 1,
        kind: "textRange",
        surface: "markdownRenderedText",
        range: { start: 1, end: 2 },
        quote: { exact: "a", prefix: "", suffix: "" },
      },
      body: "   ",
    })).toThrow("评论内容不能为空。")
  })

  it("rejects text range targets with overlong exact quotes", () => {
    const exact = "文".repeat(DRIVE_ANNOTATION_QUOTE_EXACT_MAX_LENGTH + 1)

    expect(() => parseDriveAnnotationCreateBody({
      targetKind: "textRange",
      target: {
        schemaVersion: 1,
        kind: "textRange",
        surface: "markdownRenderedText",
        range: { start: 0, end: exact.length },
        quote: { exact, prefix: "", suffix: "" },
      },
      body: "ok",
    })).toThrow("评论请求无效。")
  })

  it("reattaches exact quotes after inserted text", () => {
    const result = resolveDriveAnnotationTarget({
      target: {
        schemaVersion: 1,
        kind: "textRange",
        surface: "markdownRenderedText",
        range: { start: 2, end: 6 },
        quote: { exact: "重点文本", prefix: "这是", suffix: "内容" },
      },
      renderedText: "新增段落。这是重点文本内容。",
    })

    expect(result.anchorStatus).toBe("shifted")
    expect(result.range).toEqual({ start: 7, end: 11 })
  })

  it("marks ambiguous repeated quotes orphaned", () => {
    const result = resolveDriveAnnotationTarget({
      target: {
        schemaVersion: 1,
        kind: "textRange",
        surface: "markdownRenderedText",
        range: { start: 2, end: 4 },
        quote: { exact: "重复", prefix: "", suffix: "" },
      },
      renderedText: "重复。重复。",
    })

    expect(result.anchorStatus).toBe("orphaned")
    expect(result.range).toBeNull()
  })

  it("requires quote context when repeated text survives a version change", () => {
    const result = resolveDriveAnnotationTarget({
      target: {
        schemaVersion: 1,
        kind: "textRange",
        surface: "markdownRenderedText",
        range: { start: 0, end: 2 },
        quote: { exact: "重点", prefix: "目标", suffix: "内容" },
      },
      renderedText: "重点错误。重点错误。",
      sameVersion: false,
    })

    expect(result).toEqual({ anchorStatus: "orphaned", range: null })
  })
})
