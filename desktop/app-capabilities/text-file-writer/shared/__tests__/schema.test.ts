import { describe, expect, it } from "vitest"
import { textFileWriteInputSchema } from "../schema"

describe("textFileWriteInputSchema", () => {
  it("validates absolute paths without relying on Node path APIs", () => {
    expect(textFileWriteInputSchema.safeParse({ text: "hello", path: "/tmp/report.md" }).success).toBe(true)
    expect(textFileWriteInputSchema.safeParse({ text: "hello", path: "C:\\Temp\\report.md" }).success).toBe(true)
    expect(textFileWriteInputSchema.safeParse({ text: "hello", path: "relative/report.md" }).success).toBe(false)
  })
})
