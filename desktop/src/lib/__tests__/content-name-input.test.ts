import { describe, expect, it } from "vitest"

import { validateContentNameInput } from "../content-name-input"

describe("validateContentNameInput", () => {
  it("rejects Windows reserved names with extensions", () => {
    expect(validateContentNameInput("aux.txt")).toBe("该名称是 Windows 系统保留字，请使用其他名称。")
    expect(validateContentNameInput("con.md")).toBe("该名称是 Windows 系统保留字，请使用其他名称。")
  })

  it("allows names that only contain reserved words inside a longer segment", () => {
    expect(validateContentNameInput("auxiliary.txt")).toBeNull()
    expect(validateContentNameInput("config-con.md")).toBeNull()
  })
})
