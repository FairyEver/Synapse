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

  it("extracts every documented CommonMark relative image form", () => {
    const markdown = [
      '![plain](./images/plain.png "Plain")',
      "![angle](<./images/angle photo.png>)",
      "![encoded](./images/encoded%20photo.webp)",
      "![reference][diagram]",
      "",
      '[diagram]: <../assets/reference image.jpg> "Reference"',
    ].join("\n")

    expect(extractDriveMarkdownRelativeImages(markdown)).toEqual([
      { src: "./images/plain.png", segments: [".", "images", "plain.png"], suffix: "" },
      { src: "./images/angle photo.png", segments: [".", "images", "angle photo.png"], suffix: "" },
      { src: "./images/encoded%20photo.webp", segments: [".", "images", "encoded photo.webp"], suffix: "" },
      { src: "../assets/reference image.jpg", segments: ["..", "assets", "reference image.jpg"], suffix: "" },
    ])
  })

  it("accepts unescaped spaces only for safe inline relative image paths", () => {
    const markdown = [
      "![space](image 1.png)",
      "before ![nested](./images/team photo.webp) after",
      "[ordinary link](file name.md)",
      "![external](https://example.com/image 1.png)",
      "![document](notes 1.md)",
      "`![inline code](code image.png)`",
      "```md",
      "![code block](block image.png)",
      "```",
    ].join("\n")

    expect(extractDriveMarkdownRelativeImages(markdown)).toEqual([
      { src: "image 1.png", segments: ["image 1.png"], suffix: "" },
      { src: "./images/team photo.webp", segments: [".", "images", "team photo.webp"], suffix: "" },
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

  it("accepts explicit Windows relative image paths without rewriting their source", () => {
    expect(parseDriveMarkdownRelativeImageSrc(String.raw`.\image\订单\赠品.png?version=1#preview`)).toEqual({
      src: String.raw`.\image\订单\赠品.png?version=1#preview`,
      segments: [".", "image", "订单", "赠品.png"],
      suffix: "?version=1#preview",
    })
    expect(parseDriveMarkdownRelativeImageSrc(String.raw`..\..\assets\架构 图.webp`)).toEqual({
      src: String.raw`..\..\assets\架构 图.webp`,
      segments: ["..", "..", "assets", "架构 图.webp"],
      suffix: "",
    })
  })

  it("extracts explicit Windows paths from supported image syntax while ignoring code", () => {
    const markdown = [
      String.raw`![inline](.\image\订单\inline.png)`,
      "![reference][diagram]",
      "",
      String.raw`[diagram]: ..\assets\diagram.jpg "Diagram"`,
      "",
      String.raw`<img src=".\image\raw.webp" alt="Raw">`,
      "",
      String.raw`before ![space](.\image\team photo.png) after`,
      "",
      "```md",
      String.raw`![ignored](.\private.png)`,
      "```",
    ].join("\n")

    expect(extractDriveMarkdownRelativeImages(markdown)).toEqual([
      { src: String.raw`.\image\订单\inline.png`, segments: [".", "image", "订单", "inline.png"], suffix: "" },
      { src: String.raw`..\assets\diagram.jpg`, segments: ["..", "assets", "diagram.jpg"], suffix: "" },
      { src: String.raw`.\image\raw.webp`, segments: [".", "image", "raw.webp"], suffix: "" },
      { src: String.raw`.\image\team photo.png`, segments: [".", "image", "team photo.png"], suffix: "" },
    ])
  })

  it("rejects ambiguous or unsafe backslash paths, roots, controls and invalid encoding", () => {
    expect(parseDriveMarkdownRelativeImageSrc("/image/a.png")).toBeNull()
    expect(parseDriveMarkdownRelativeImageSrc("image%2Fa.png")).toBeNull()
    expect(parseDriveMarkdownRelativeImageSrc("image%5Ca.png")).toBeNull()
    expect(parseDriveMarkdownRelativeImageSrc(String.raw`.\image%5Ca.png`)).toBeNull()
    expect(parseDriveMarkdownRelativeImageSrc(String.raw`image\a.png`)).toBeNull()
    expect(parseDriveMarkdownRelativeImageSrc(String.raw`.\image/a.png`)).toBeNull()
    expect(parseDriveMarkdownRelativeImageSrc(String.raw`\image\a.png`)).toBeNull()
    expect(parseDriveMarkdownRelativeImageSrc(String.raw`\\server\share\a.png`)).toBeNull()
    expect(parseDriveMarkdownRelativeImageSrc(String.raw`C:\image\a.png`)).toBeNull()
    expect(parseDriveMarkdownRelativeImageSrc(String.raw`https:\example.com\a.png`)).toBeNull()
    expect(parseDriveMarkdownRelativeImageSrc(String.raw`.\image\\a.png`)).toBeNull()
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
