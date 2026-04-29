import { describe, expect, it } from "vitest"

import { getRepositoryNameFromPath } from "../path-utils"

describe("getRepositoryNameFromPath", () => {
  it("reads the last segment from Windows paths", () => {
    expect(getRepositoryNameFromPath("C:\\Users\\Ada\\SynapseRepo")).toBe("SynapseRepo")
    expect(getRepositoryNameFromPath("C:\\Users\\Ada\\SynapseRepo\\")).toBe("SynapseRepo")
  })
})
