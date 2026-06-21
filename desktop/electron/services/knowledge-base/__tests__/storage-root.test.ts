import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  isPathInside,
  resolveKnowledgeBaseStorageRoot,
} from "../storage-root"

describe("knowledge base storage root", () => {
  it("uses userData for default mode", () => {
    expect(resolveKnowledgeBaseStorageRoot({
      userDataPath: "/tmp/userData",
      storage: { mode: "default" },
    })).toBe("/tmp/userData")
  })

  it("uses the custom root for custom mode", () => {
    expect(resolveKnowledgeBaseStorageRoot({
      userDataPath: "/tmp/userData",
      storage: { mode: "custom", rootPath: "/Volumes/Data/SynapseData" },
    })).toBe(path.resolve("/Volumes/Data/SynapseData"))
  })

  it("detects a child path", () => {
    expect(isPathInside("/tmp/root/knowledge-bases/kb-1", "/tmp/root/knowledge-bases")).toBe(true)
    expect(isPathInside("/tmp/root/knowledge-bases/..backup", "/tmp/root/knowledge-bases")).toBe(true)
    expect(isPathInside("/tmp/root-other", "/tmp/root/knowledge-bases")).toBe(false)
    expect(isPathInside("/tmp/root", "/tmp/root/knowledge-bases")).toBe(false)
  })
})
