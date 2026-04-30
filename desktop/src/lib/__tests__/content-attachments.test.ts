import { describe, expect, it } from "vitest"

import {
  normalizeContentAttachmentPath,
  normalizeContentAttachmentSegment,
} from "../content-attachments"

describe("normalizeContentAttachmentPath", () => {
  it("keeps nested paths while removing traversal segments", () => {
    expect(normalizeContentAttachmentPath("../assets/./template.txt"))
      .toBe("assets/template.txt")
  })

  it("converts Windows-unsafe path segments", () => {
    expect(normalizeContentAttachmentPath("assets/a:b*?.txt"))
      .toBe("assets/a_b__.txt")
  })

  it("protects Windows reserved names and trailing dots", () => {
    expect(normalizeContentAttachmentPath("CON.txt/aux. /valid. "))
      .toBe("_CON.txt/_aux/valid")
  })

  it("removes absolute drive prefixes and empty unsafe segments", () => {
    expect(normalizeContentAttachmentPath("C:\\temp\\...\\NUL"))
      .toBe("C_/temp/_NUL")
  })

  it("normalizes one Windows-safe file segment", () => {
    expect(normalizeContentAttachmentSegment("C:\\temp\\AUX.txt"))
      .toBe("_AUX.txt")
  })
})
