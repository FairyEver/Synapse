import { access, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { FetchUrl } from "../../source-acquisition/url-source"
import { knowledgeBaseLogger } from "../logging"
import { stageKnowledgeBaseUrlSource } from "../source-staging"

const fsMocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
}))

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  fsMocks.writeFile.mockImplementation(actual.writeFile)
  return {
    ...actual,
    writeFile: fsMocks.writeFile,
  }
})

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-stage-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  vi.restoreAllMocks()
  fsMocks.writeFile.mockClear()
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("knowledge base URL source staging", () => {
  it("stages URL sources into the dated raw web directory", async () => {
    const projectPath = await tempDir()
    const fetchUrl: FetchUrl = async () => ({
      url: "https://example.com/articles/alpha?signature=final-secret&utm_source=test",
      status: 200,
      headers: {
        get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null,
      },
      text: async () => "<html><body><article><h1>Alpha</h1><p>Body</p></article></body></html>",
    })

    const result = await stageKnowledgeBaseUrlSource({
      projectPath,
      url: "https://example.com/articles/alpha?token=input-secret&utm_source=test",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result.uploaded).toEqual([expect.objectContaining({
      originalPath: "https://example.com/articles/alpha?token=%5Bredacted%5D&utm_source=test",
      relativePath: ".raw/web/2026/05/24/alpha.md",
      name: "alpha.md",
      sourceUrl: "https://example.com/articles/alpha?token=%5Bredacted%5D&utm_source=test",
    })])
    expect(result.skipped).toEqual([])
    await expect(readFile(path.join(projectPath, ".raw", "web", "2026", "05", "24", "alpha.md"), "utf8"))
      .resolves.toContain('source_format: "url"')
    const rawMarkdown = await readFile(path.join(projectPath, ".raw", "web", "2026", "05", "24", "alpha.md"), "utf8")
    expect(rawMarkdown).not.toContain("input-secret")
    expect(rawMarkdown).not.toContain("final-secret")
    await expect(access(path.join(projectPath, "wiki"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("stages URL sources into the selected raw directory", async () => {
    const projectPath = await tempDir()
    const fetchUrl: FetchUrl = async () => ({
      url: "https://example.com/articles/alpha",
      status: 200,
      headers: {
        get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null,
      },
      text: async () => "<html><body><h1>Alpha</h1></body></html>",
    })

    const result = await stageKnowledgeBaseUrlSource({
      projectPath,
      targetDirectoryPath: "client-a",
      url: "https://example.com/articles/alpha",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result.uploaded[0]).toMatchObject({
      relativePath: ".raw/client-a/alpha.md",
      name: "alpha.md",
      sourceKind: "url",
    })
    await expect(readFile(path.join(projectPath, ".raw", "client-a", "alpha.md"), "utf8"))
      .resolves.toContain('source_format: "url"')
  })

  it("redacts URL source skipped paths and keeps acquisition failure reasons", async () => {
    const projectPath = await tempDir()
    const warn = vi.spyOn(knowledgeBaseLogger, "warn").mockImplementation(() => undefined)
    const fetchUrl: FetchUrl = async () => {
      throw new Error("fetch failed")
    }

    const result = await stageKnowledgeBaseUrlSource({
      projectPath,
      url: "https://example.com/articles/alpha?token=input-secret",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toEqual({
      uploaded: [],
      skipped: [{ path: "https://example.com/articles/alpha?token=%5Bredacted%5D", reason: "network_error" }],
    })
    expect(warn).toHaveBeenCalledWith("Knowledge Base URL source acquisition failed.", expect.objectContaining({
      code: "network_error",
      url: "https://example.com/articles/alpha?token=%5Bredacted%5D",
    }))
    expect(JSON.stringify(result)).not.toContain("input-secret")
  })

  it("skips binary-looking URL responses that do not declare a content type", async () => {
    const projectPath = await tempDir()
    const fetchUrl: FetchUrl = async () => ({
      url: "https://example.com/download",
      status: 200,
      headers: {
        get: () => null,
      },
      text: async () => "\u0000PDF binary",
    })

    const result = await stageKnowledgeBaseUrlSource({
      projectPath,
      url: "https://example.com/download",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toEqual({
      uploaded: [],
      skipped: [{ path: "https://example.com/download", reason: "unsupported_content_type" }],
    })
    await expect(access(path.join(projectPath, ".raw", "web"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("keeps URL validation failures visible as skipped URL reasons", async () => {
    const projectPath = await tempDir()
    const fetchUrl = vi.fn<FetchUrl>()

    const result = await stageKnowledgeBaseUrlSource({
      projectPath,
      url: "javascript:alert(1)",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toEqual({
      uploaded: [],
      skipped: [{ path: "javascript:alert(1)", reason: "unsupported_protocol" }],
    })
    expect(fetchUrl).not.toHaveBeenCalled()
  })

  it("resolves URL source filename collisions", async () => {
    const projectPath = await tempDir()
    const fetchUrl: FetchUrl = async () => ({
      url: "https://example.com/articles/alpha",
      status: 200,
      headers: {
        get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null,
      },
      text: async () => "<html><body><h1>Alpha</h1></body></html>",
    })
    const input = {
      projectPath,
      url: "https://example.com/articles/alpha",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    }

    const first = await stageKnowledgeBaseUrlSource(input)
    const second = await stageKnowledgeBaseUrlSource(input)

    expect(first.uploaded[0]).toMatchObject({ relativePath: ".raw/web/2026/05/24/alpha.md" })
    expect(second.uploaded[0]).toMatchObject({ relativePath: ".raw/web/2026/05/24/alpha-2.md" })
  })

  it("does not expose a partial source when writing markdown fails", async () => {
    const projectPath = await tempDir()
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
    fsMocks.writeFile.mockImplementationOnce(async (filePath, _content, options) => {
      await actualFs.writeFile(filePath, "partial markdown", options)
      throw new Error("disk full")
    })
    const fetchUrl: FetchUrl = async () => ({
      url: "https://example.com/articles/alpha",
      status: 200,
      headers: {
        get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null,
      },
      text: async () => "<html><body><h1>Alpha</h1></body></html>",
    })

    await expect(stageKnowledgeBaseUrlSource({
      projectPath,
      url: "https://example.com/articles/alpha",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })).rejects.toThrow("disk full")

    await expect(access(path.join(projectPath, ".raw", "web", "2026", "05", "24", "alpha.md")))
      .rejects.toMatchObject({ code: "ENOENT" })
  })

  it("stages URL sources with Windows reserved path names into safe files", async () => {
    const projectPath = await tempDir()
    const cases = [
      ["https://example.com/con", "con-source.md"],
      ["https://example.com/prn.html", "prn-source.md"],
      ["https://example.com/COM1", "com1-source.md"],
    ] as const

    for (const [url, fileName] of cases) {
      const fetchUrl: FetchUrl = async () => ({
        url,
        status: 200,
        headers: {
          get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null,
        },
        text: async () => `<html><body><h1>${fileName}</h1></body></html>`,
      })

      const result = await stageKnowledgeBaseUrlSource({
        projectPath,
        url,
        fetchUrl,
        now: () => new Date("2026-05-24T00:00:00.000Z"),
      })

      expect(result.uploaded[0]).toMatchObject({
        relativePath: `.raw/web/2026/05/24/${fileName}`,
        name: fileName,
      })
      await expect(access(path.join(projectPath, ".raw", "web", "2026", "05", "24", fileName)))
        .resolves.toBeUndefined()
    }
  })
})
