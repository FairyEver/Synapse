import { describe, expect, it } from "vitest"

import { shouldBypassDeleteConfirm } from "../delete-confirm-bypass"

describe("shouldBypassDeleteConfirm", () => {
  it("bypasses delete confirmation only when Alt is pressed", () => {
    expect(shouldBypassDeleteConfirm({ altKey: true })).toBe(true)
    expect(shouldBypassDeleteConfirm({ altKey: false })).toBe(false)
  })
})
