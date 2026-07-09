import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}))

import { readRepositorySeedContents } from "../repository-template-service"

describe("RepositoryTemplateService", () => {
  it("does not seed legacy built-in repository templates when the template directory is absent", async () => {
    const seeds = await readRepositorySeedContents()

    expect(seeds).toEqual([])
  })
})
