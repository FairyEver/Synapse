import { describe, expect, it } from "vitest"
import { executeDriveMarkdownPdfWorkerRequest } from "./drive-markdown-pdf-render-task"

describe("Drive Markdown PDF render task", () => {
  it("returns compact unique image discovery instead of the Markdown projection", async () => {
    const occurrences = 5_000
    const result = await executeDriveMarkdownPdfWorkerRequest({
      kind: "discover-images",
      markdown: "![重复图片](image.png)\n".repeat(occurrences),
      allowStandaloneRawImages: true,
      maxImages: 256,
    })

    expect(result).toEqual({
      kind: "image-discovery",
      images: [{
        source: "image.png",
        resourceKey: "relative:image.png",
        occurrences,
      }],
      tooManyImages: false,
    })
    expect(JSON.stringify(result)).not.toContain("projection")
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(512)
  })

  it("returns only HTML from the final rendering pass", async () => {
    const result = await executeDriveMarkdownPdfWorkerRequest({
      kind: "render-html",
      markdown: "![图片](image.png)",
      allowStandaloneRawImages: true,
      imageResourceKeys: new Map([["relative:image.png", "image-1"]]),
    })

    expect(result.kind).toBe("html")
    if (result.kind !== "html") throw new Error("Unexpected worker result")
    expect(result.html).toContain('data-drive-pdf-resource-key="image-1"')
    expect(Object.keys(result)).toEqual(["kind", "html"])
  })

  it("bounds discovery output and can restrict authorization discovery", async () => {
    const limited = await executeDriveMarkdownPdfWorkerRequest({
      kind: "discover-images",
      markdown: Array.from({ length: 257 }, (_, index) => `![${index}](image-${index}.png)`).join("\n"),
      allowStandaloneRawImages: true,
      maxImages: 256,
    })
    expect(limited.kind).toBe("image-discovery")
    if (limited.kind !== "image-discovery") throw new Error("Unexpected worker result")
    expect(limited.images).toHaveLength(256)
    expect(limited.tooManyImages).toBe(true)

    const filtered = await executeDriveMarkdownPdfWorkerRequest({
      kind: "discover-images",
      markdown: "![允许](allowed.png)\n![忽略](ignored.png)",
      allowStandaloneRawImages: true,
      maxImages: 256,
      resourceKeys: new Set(["relative:allowed.png"]),
    })
    expect(filtered).toMatchObject({
      kind: "image-discovery",
      images: [{ resourceKey: "relative:allowed.png" }],
      tooManyImages: false,
    })
  })
})
