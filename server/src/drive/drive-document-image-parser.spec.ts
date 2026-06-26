import { describe, expect, it } from "vitest"
import { extractDriveMarkdownImages, replaceDriveMarkdownImageSources } from "./drive-document-image-parser"

describe("drive document image parser", () => {
  it("extracts markdown, html, and mdx image sources with stable keys", () => {
    const images = extractDriveMarkdownImages([
      "![diagram](https://example.test/a.png)",
      "![again](https://example.test/a.png)",
      '<img src="https://cdn.test/b.webp" alt="hero" />',
      "![relative](./images/c.png)",
      "![inline](data:image/png;base64,aaaa)",
    ].join("\n"))

    expect(images).toHaveLength(4)
    expect(images[0]).toMatchObject({ src: "https://example.test/a.png", occurrenceCount: 2, altText: "diagram" })
    expect(images[1]).toMatchObject({ src: "https://cdn.test/b.webp", occurrenceCount: 1, altText: "hero" })
    expect(images[2]).toMatchObject({ src: "./images/c.png", occurrenceCount: 1 })
    expect(images[3]).toMatchObject({ src: "data:image/png;base64,aaaa", occurrenceCount: 1 })
    expect(images[0]!.imageKey).toMatch(/^img_[0-9a-f]{16}$/u)
  })

  it("replaces only image node URLs and preserves links and prose", () => {
    const markdown = [
      "![diagram](https://example.test/a.png)",
      "",
      "[same url](https://example.test/a.png)",
      "",
      "`https://example.test/a.png`",
    ].join("\n")

    const result = replaceDriveMarkdownImageSources(markdown, new Map([
      ["https://example.test/a.png", "https://synapse.test/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ"],
    ]))

    expect(result.markdown).toContain("![diagram](https://synapse.test/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ)")
    expect(result.markdown).toContain("[same url](https://example.test/a.png)")
    expect(result.markdown).toContain("`https://example.test/a.png`")
    expect(result.replacedOccurrenceCount).toBe(1)
  })

  it("does not replace matching text inside markdown image alt text", () => {
    const markdown = "![https://example.test/a.png](https://example.test/a.png)"

    const result = replaceDriveMarkdownImageSources(markdown, new Map([
      ["https://example.test/a.png", "https://synapse.test/files/asset"],
    ]))

    expect(result.markdown).toBe("![https://example.test/a.png](https://synapse.test/files/asset)")
    expect(result.replacedOccurrenceCount).toBe(1)
  })

  it("replaces raw html image src attributes and preserves other attributes", () => {
    const markdown = [
      '<img class="hero" src="https://cdn.test/b.webp" alt="hero" loading="lazy" />',
      "",
      '<a href="https://cdn.test/b.webp">asset</a>',
    ].join("\n")

    const result = replaceDriveMarkdownImageSources(markdown, new Map([
      ["https://cdn.test/b.webp", "https://synapse.test/files/html_asset"],
    ]))

    expect(result.markdown).toContain('<img class="hero" src="https://synapse.test/files/html_asset" alt="hero" loading="lazy" />')
    expect(result.markdown).toContain('<a href="https://cdn.test/b.webp">asset</a>')
    expect(result.replacedOccurrenceCount).toBe(1)
  })

  it("ignores image-looking markdown inside fenced code blocks", () => {
    const markdown = [
      "![real](https://example.test/real.png)",
      "",
      "```md",
      "![fake](https://example.test/fake.png)",
      '<img src="https://example.test/fake-html.png" alt="fake" />',
      "```",
    ].join("\n")

    const images = extractDriveMarkdownImages(markdown)
    const result = replaceDriveMarkdownImageSources(markdown, new Map([
      ["https://example.test/real.png", "https://synapse.test/files/real"],
      ["https://example.test/fake.png", "https://synapse.test/files/fake"],
      ["https://example.test/fake-html.png", "https://synapse.test/files/fake-html"],
    ]))

    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({ src: "https://example.test/real.png", occurrenceCount: 1, altText: "real" })
    expect(result.markdown).toContain("![real](https://synapse.test/files/real)")
    expect(result.markdown).toContain("![fake](https://example.test/fake.png)")
    expect(result.markdown).toContain('<img src="https://example.test/fake-html.png" alt="fake" />')
    expect(result.replacedOccurrenceCount).toBe(1)
  })
})
