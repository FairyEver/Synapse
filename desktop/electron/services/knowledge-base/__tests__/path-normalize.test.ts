import { describe, expect, it } from "vitest"

import {
  normalizeKnowledgeBaseRawPath,
  normalizeKnowledgeBaseRelativePath,
} from "../path-normalize"

describe("knowledge base path normalization", () => {
  it("normalizes both POSIX and Windows separators", () => {
    expect(normalizeKnowledgeBaseRelativePath(String.raw`.raw\folder/source.md`))
      .toBe(".raw/folder/source.md")
  })

  it("trims raw path boundary slashes after separator normalization", () => {
    expect(normalizeKnowledgeBaseRawPath(String.raw`/folder\nested/`))
      .toBe("folder/nested")
  })
})
