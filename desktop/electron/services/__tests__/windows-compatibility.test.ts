import { describe, expect, it } from "vitest"

import { inspectWindowsConfiguredPaths } from "../windows-compatibility"

describe("inspectWindowsConfiguredPaths", () => {
  it("accepts Windows extended-length drive and UNC prefixes", () => {
    const summary = inspectWindowsConfiguredPaths([
      {
        kind: "repository",
        id: "repo-1",
        name: "Repo",
        path: "\\\\?\\C:\\very\\long\\repo",
      },
      {
        kind: "project",
        id: "project-1",
        name: "Project",
        path: "\\\\?\\UNC\\server\\share\\deep\\project",
      },
    ])

    expect(summary.unsafeEntryCount).toBe(0)
    expect(summary.nonAbsoluteEntryCount).toBe(0)
    expect(summary.nonFullyQualifiedEntryCount).toBe(0)
    expect(summary.entries.map((entry) => entry.unsafeSegments)).toEqual([[], []])
  })
})
