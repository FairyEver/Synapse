import { describe, expect, it } from "vitest"
import {
  skillUninstallQuerySchema,
  skillUninstallTargetSchema,
} from "../../shared/schema"

describe("skill uninstaller schemas", () => {
  it("accepts a name with an optional search root", () => {
    expect(skillUninstallQuerySchema.parse({ name: "jenkins" })).toEqual({ name: "jenkins" })
    expect(skillUninstallQuerySchema.parse({
      name: "jenkins",
      searchRootPath: "/repo",
    })).toEqual({ name: "jenkins", searchRootPath: "/repo" })
  })

  it("rejects empty names and empty target paths", () => {
    expect(() => skillUninstallQuerySchema.parse({ name: "  " })).toThrow()
    expect(() => skillUninstallTargetSchema.parse({
      query: { name: "jenkins" },
      path: "",
    })).toThrow()
  })
})
