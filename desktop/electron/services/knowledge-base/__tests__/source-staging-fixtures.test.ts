import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { buildFileConversionFixtures, type FileConversionFixturePaths } from "../../file-conversion/__tests__/fixtures/build-fixtures"
import { KnowledgeBaseService } from "../knowledge-base-service"
import { scanKnowledgeBaseSources } from "../source-scan"

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
  },
}))

const roots: string[] = []
const fixedNow = () => new Date("2026-05-24T08:00:00.000Z")

type FixtureCase = {
  readonly format: string
  readonly fixtureKey: keyof FileConversionFixturePaths
  readonly rawPath: string
  readonly originalPath: string
}

const fixtureCases: readonly FixtureCase[] = [
  {
    format: "docx",
    fixtureKey: "docxBasic",
    rawPath: ".raw/documents/2026/05/24/basic.md",
    originalPath: "_attachments/originals/2026/05/24/basic.docx",
  },
  {
    format: "xlsx",
    fixtureKey: "xlsxMultiSheet",
    rawPath: ".raw/spreadsheets/2026/05/24/multi-sheet.md",
    originalPath: "_attachments/originals/2026/05/24/multi-sheet.xlsx",
  },
  {
    format: "pdf",
    fixtureKey: "pdfText",
    rawPath: ".raw/pdfs/2026/05/24/text.md",
    originalPath: "_attachments/originals/2026/05/24/text.pdf",
  },
  {
    format: "pptx",
    fixtureKey: "pptxBasic",
    rawPath: ".raw/presentations/2026/05/24/basic.md",
    originalPath: "_attachments/originals/2026/05/24/basic.pptx",
  },
]

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-fixture-stage-"))
  roots.push(dir)
  return dir
}

async function managedFixture() {
  const projectId = "kb-1"
  const userDataPath = await tempDir()
  const projectPath = path.join(userDataPath, "knowledge-bases", projectId)
  await mkdir(projectPath, { recursive: true })
  const service = new KnowledgeBaseService({
    now: fixedNow,
    userDataPath,
    loadConfig: async () => ({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "system",
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
        projects: [{
          id: projectId,
          name: "Knowledge",
          path: `synapse-kb://${projectId}`,
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-24",
              managed: true,
              runtimeId: projectId,
            },
          },
        }],
      },
      agent: { defaultPermissionMode: "default", defaultProviderModel: null },
    }),
  })
  return { projectId, projectPath, service }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("knowledge base staging with real converted fixtures", () => {
  it.each(fixtureCases)("stages $format originals and generated markdown", async ({
    format,
    fixtureKey,
    rawPath,
    originalPath,
  }) => {
    const fixtureRoot = await tempDir()
    const fixtures = await buildFileConversionFixtures(fixtureRoot)
    const { projectId, projectPath, service } = await managedFixture()

    const result = await service.uploadSources({ projectId, filePaths: [fixtures[fixtureKey]] })

    expect(result.skipped).toEqual([])
    expect(result.uploaded).toEqual([expect.objectContaining({
      originalPath: fixtures[fixtureKey],
      relativePath: rawPath,
      originalRelativePath: originalPath,
    })])
    await expect(access(path.join(projectPath, originalPath))).resolves.toBeUndefined()
    await expect(access(path.join(projectPath, rawPath))).resolves.toBeUndefined()

    const generatedMarkdown = await readFile(path.join(projectPath, rawPath), "utf8")
    expect(generatedMarkdown).toContain(`source_original: "${originalPath}"`)
    expect(generatedMarkdown).toContain(`source_format: "${format}"`)
    expect(generatedMarkdown).toContain('converted_at: "2026-05-24T08:00:00.000Z"')

    const scan = await scanKnowledgeBaseSources(projectPath)
    expect(scan.sources).toEqual([expect.objectContaining({
      relativePath: rawPath,
      state: "new",
    })])
    expect(scan.skippedSources).toEqual([])
  })
})
