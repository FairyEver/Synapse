import { describe, expect, it } from "vitest"
import {
  extractDriveMarkdownRelativeImages,
  isPlainDriveMarkdownName,
  isSafeDriveMarkdownRasterName,
  parseDriveMarkdownRelativeImageSrc,
  parseStandaloneDriveMarkdownRawImage,
} from "./drive-markdown-relative-images"

describe("drive markdown relative images", () => {
  it("limits relative image capability to plain Markdown files", () => {
    expect(isPlainDriveMarkdownName("readme.md")).toBe(true)
    expect(isPlainDriveMarkdownName("README.MARKDOWN")).toBe(true)
    expect(isPlainDriveMarkdownName("page.mdx")).toBe(false)
    expect(isPlainDriveMarkdownName("index.html")).toBe(false)
    expect(isPlainDriveMarkdownName("index.htm")).toBe(false)
  })

  it("extracts inline, reference and standalone raw images while ignoring code", () => {
    const markdown = [
      "![inline](./images/a.png)",
      "![reference][diagram]",
      "",
      "[diagram]: ../assets/diagram.png \"Diagram\"",
      "",
      '<img src="images/raw.png" alt="Raw" width="320" class="ignored">',
      "",
      "```md",
      "![ignored](./private.png)",
      "```",
      "",
      "![external](https://example.com/a.png)",
    ].join("\n")

    expect(extractDriveMarkdownRelativeImages(markdown)).toEqual([
      { src: "./images/a.png", segments: [".", "images", "a.png"], suffix: "" },
      { src: "../assets/diagram.png", segments: ["..", "assets", "diagram.png"], suffix: "" },
      { src: "images/raw.png", segments: ["images", "raw.png"], suffix: "" },
    ])
  })

  it("decodes path segments once, normalizes Unicode and preserves query and fragment", () => {
    expect(parseDriveMarkdownRelativeImageSrc("image/%E4%B8%AD%E6%96%87.png?version=1#preview")).toEqual({
      src: "image/%E4%B8%AD%E6%96%87.png?version=1#preview",
      segments: ["image", "中文.png"],
      suffix: "?version=1#preview",
    })
    expect(parseDriveMarkdownRelativeImageSrc(`image/${"e\u0301"}.png`)?.segments).toEqual(["image", "é.png"])
    expect(parseDriveMarkdownRelativeImageSrc("image/%252f.png")?.segments).toEqual(["image", "%2f.png"])
  })

  it("rejects roots, encoded separators, backslashes, controls and invalid encoding", () => {
    expect(parseDriveMarkdownRelativeImageSrc("/image/a.png")).toBeNull()
    expect(parseDriveMarkdownRelativeImageSrc("image%2Fa.png")).toBeNull()
    expect(parseDriveMarkdownRelativeImageSrc("image%5Ca.png")).toBeNull()
    expect(parseDriveMarkdownRelativeImageSrc("image\\a.png")).toBeNull()
    expect(parseDriveMarkdownRelativeImageSrc("image/%00a.png")).toBeNull()
    expect(parseDriveMarkdownRelativeImageSrc("image/%zz.png")).toBeNull()
  })

  it("keeps only safe attributes from a standalone raw image", () => {
    expect(parseStandaloneDriveMarkdownRawImage(
      '<img src="./a.png" alt="A" title="T" width="10" height="20" loading="lazy" style="color:red" onerror="x">',
    )).toEqual({
      src: "./a.png",
      alt: "A",
      title: "T",
      width: "10",
      height: "20",
      loading: "lazy",
    })
    expect(parseStandaloneDriveMarkdownRawImage('<div><img src="./a.png"></div>')).toBeNull()
    expect(parseStandaloneDriveMarkdownRawImage("<img src=./a.png>")).toBeNull()
  })

  it("recognizes only safe raster file names", () => {
    expect(isSafeDriveMarkdownRasterName("a.PNG")).toBe(true)
    expect(isSafeDriveMarkdownRasterName("a.avif")).toBe(true)
    expect(isSafeDriveMarkdownRasterName("a.svg")).toBe(false)
    expect(isSafeDriveMarkdownRasterName("a.html")).toBe(false)
  })

  it("limits unique relative image sources without counting duplicates twice", () => {
    const markdown = [
      "![first](./same.png)",
      "![duplicate](./same.png)",
      ...Array.from({ length: 300 }, (_, index) => `![${index}](./${index}.png)`),
    ].join("\n")

    const references = extractDriveMarkdownRelativeImages(markdown)
    expect(references).toHaveLength(256)
    expect(references[0]?.src).toBe("./same.png")
    expect(references.at(-1)?.src).toBe("./254.png")
  })
})
