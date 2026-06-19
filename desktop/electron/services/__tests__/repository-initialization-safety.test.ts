import type { Dirent } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createRepositoryInitializationPreview } from "../repository-initialization-safety"

const osMock = vi.hoisted(() => ({
  homedir: vi.fn(() => "/Users/test"),
}))

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>()
  return {
    ...actual,
    default: {
      ...actual,
      homedir: osMock.homedir,
    },
    homedir: osMock.homedir,
  }
})

const originalPlatform = process.platform

function mockPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  })
}

async function previewForPath(localPath: string) {
  return createRepositoryInitializationPreview({
    localPath,
    entries: [] as Dirent[],
  })
}

describe("repository initialization safety", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    osMock.homedir.mockReturnValue("/Users/test")
    mockPlatform(originalPlatform)
  })

  it("detects protected user directories case-insensitively on Windows", async () => {
    mockPlatform("win32")
    osMock.homedir.mockReturnValue("C:\\Users\\Ada")
    vi.spyOn(process, "cwd").mockReturnValue("D:\\Synapse")

    const preview = await previewForPath("c:\\users\\ada\\documents")

    expect(preview.dangerFlags).toContain("documents")
  })

  it("detects source checkout ancestors case-insensitively on Windows", async () => {
    mockPlatform("win32")
    osMock.homedir.mockReturnValue("C:\\Users\\Ada")
    vi.spyOn(process, "cwd").mockReturnValue("C:\\Workspace\\Synapse\\desktop")

    const preview = await previewForPath("c:\\workspace\\synapse")

    expect(preview.dangerFlags).toContain("synapse-source-checkout")
  })
})
