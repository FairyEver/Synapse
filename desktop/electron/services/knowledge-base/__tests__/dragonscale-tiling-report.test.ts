import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  DragonScaleTilingService,
  type DragonScaleEmbeddingProvider,
} from "../index"

const roots: string[] = []

class ReportEmbeddingProvider implements DragonScaleEmbeddingProvider {
  async isReachable(): Promise<boolean> {
    return true
  }

  async hasModel(): Promise<boolean> {
    return true
  }

  async embed(input: { readonly text: string }): Promise<readonly number[]> {
    if (input.text.includes("Beta")) return [1, 0]
    if (input.text.includes("Review")) return [0.85, Math.sqrt(1 - 0.85 ** 2)]
    return [1, 0]
  }
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-tiling-report-"))
  roots.push(dir)
  return dir
}

async function writePage(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, ...relativePath.split("/"))
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("DragonScaleTilingService reports", () => {
  it("formats upstream-compatible markdown and writes confined reports", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "tiling-thresholds.json"), `${JSON.stringify({
      version: 1,
      model: "nomic-embed-text",
      bands: { error: 0.95, review: 0.8 },
      calibrated: false,
      calibration_pairs_labeled: 0,
    })}\n`)
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\n---\n\nAlpha body\n")
    await writePage(root, "wiki/concepts/Beta.md", "---\ntype: concept\n---\n\nBeta body\n")
    await writePage(root, "wiki/concepts/Review.md", "---\ntype: concept\n---\n\nReview body\n")

    const result = await new DragonScaleTilingService({
      embeddingProvider: new ReportEmbeddingProvider(),
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    }).check(root, { reportPath: "wiki/meta/tiling-report-2026-05-24.md" })

    expect(result.status).toBe("ok")
    expect(result.reportMarkdown).toContain("# Semantic Tiling Report")
    expect(result.reportMarkdown).toContain("- generated: 2026-05-24T00:00:00Z")
    expect(result.reportMarkdown).toContain("## Errors (similarity >= 0.95)")
    expect(result.reportMarkdown).toContain("## Review (0.8 <= similarity < 0.95)")
    expect(result.reportMarkdown).toContain("`1.0000` wiki/concepts/Alpha.md -- wiki/concepts/Beta.md")
    expect(result.reportMarkdown).toContain("`0.8500`")
    await expect(readFile(path.join(root, "wiki", "meta", "tiling-report-2026-05-24.md"), "utf8"))
      .resolves.toBe(result.reportMarkdown)
  })

  it("renders none for empty error and review sections", async () => {
    const root = await tempDir()
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\n---\n\nAlpha body\n")

    const result = await new DragonScaleTilingService({
      embeddingProvider: new ReportEmbeddingProvider(),
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    }).check(root)

    expect(result.reportMarkdown).toContain("## Errors (similarity >= 0.9)\n\n- none")
    expect(result.reportMarkdown).toContain("## Review (0.8 <= similarity < 0.9)\n\n- none")
  })

  it("redacts Ollama URL credentials in generated reports", async () => {
    const root = await tempDir()
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\n---\n\nAlpha body\n")

    const result = await new DragonScaleTilingService({
      embeddingProvider: new ReportEmbeddingProvider(),
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    }).check(root, {
      ollamaUrl: "http://user:secret@127.0.0.1:11434?token=sk-secret&ok=1",
      reportPath: "wiki/meta/tiling-report.md",
    })

    expect(result.ollamaUrl).toBe("http://127.0.0.1:11434/?token=%5Bredacted%5D&ok=1")
    expect(result.reportMarkdown).toContain("- ollama_url: http://127.0.0.1:11434/?token=%5Bredacted%5D&ok=1")
    expect(result.reportMarkdown).not.toContain("user:secret")
    expect(result.reportMarkdown).not.toContain("sk-secret")
    await expect(readFile(path.join(root, "wiki", "meta", "tiling-report.md"), "utf8"))
      .resolves.toBe(result.reportMarkdown)
  })

  it("rejects report paths that escape the vault", async () => {
    const root = await tempDir()
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\n---\n\nAlpha body\n")

    await expect(new DragonScaleTilingService({
      embeddingProvider: new ReportEmbeddingProvider(),
    }).check(root, { reportPath: "../tiling-report.md" })).resolves.toMatchObject({
      status: "usage-error",
      message: expect.stringContaining("escapes vault"),
    })
  })

  it("rejects report writes through symlinked directories", async () => {
    const root = await tempDir()
    const outside = await tempDir()
    await mkdir(path.join(root, "wiki"), { recursive: true })
    await symlink(outside, path.join(root, "wiki", "meta"), "dir")
    await writePage(root, "wiki/concepts/Alpha.md", "---\ntype: concept\n---\n\nAlpha body\n")

    await expect(new DragonScaleTilingService({
      embeddingProvider: new ReportEmbeddingProvider(),
    }).check(root, { reportPath: "wiki/meta/tiling-report.md" })).rejects.toThrow("symlinks")
  })
})
