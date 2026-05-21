import { describe, expect, it } from "vitest"

import {
  createEmptyContentPayload,
  isContentPayloadDirty,
} from "../lib/content-payload"

describe("content payload dirty state", () => {
  it("treats whitespace-only text fields as empty", () => {
    expect(isContentPayloadDirty(createEmptyContentPayload({
      title: "  ",
      usage: " ",
      description: "\n",
      category: "\t",
      icon: " ",
      iconImage: " ",
      content: "  \n",
    }))).toBe(false)
  })
})
