import { describe, expect, it } from "vitest"
import { countVisibleContentIds } from "../components/content-browser-utils"

describe("content browser utils", () => {
  it("counts only ids visible in the current repository item list", () => {
    expect(countVisibleContentIds(["a", "missing", "b"], [{ id: "a" }, { id: "b" }])).toBe(2)
  })
})
