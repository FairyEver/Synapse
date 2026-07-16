import type { BigIntStats } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { hasSameFileSnapshot, isPathInside } from "../fs-utils"

describe("fs-utils", () => {
  it("accepts only the root and its descendants", () => {
    const root = path.join(path.parse(process.cwd()).root, "repo", "skill")

    expect(isPathInside(root, root)).toBe(true)
    expect(isPathInside(root, path.join(root, "nested", "SKILL.md"))).toBe(true)
    expect(isPathInside(root, path.join(root, "..backup", "SKILL.md"))).toBe(true)
    expect(isPathInside(root, path.dirname(root))).toBe(false)
    expect(isPathInside(root, `${root}-other`)).toBe(false)
  })

  it("compares every file identity field used by guarded reads", () => {
    const snapshot = {
      dev: 1n,
      ino: 2n,
      mode: 3n,
      size: 4n,
      mtimeNs: 5n,
      ctimeNs: 6n,
    } as BigIntStats

    expect(hasSameFileSnapshot(snapshot, { ...snapshot } as BigIntStats)).toBe(true)
    for (const field of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"] as const) {
      expect(hasSameFileSnapshot(snapshot, { ...snapshot, [field]: snapshot[field] + 1n } as BigIntStats)).toBe(false)
    }
  })
})
