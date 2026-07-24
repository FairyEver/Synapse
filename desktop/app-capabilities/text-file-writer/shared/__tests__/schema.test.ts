import { describe, expect, it } from "vitest"
import { textFileWriteInputSchema } from "../schema"

describe("textFileWriteInputSchema", () => {
  it("validates absolute paths without relying on Node path APIs", () => {
    expect(textFileWriteInputSchema.safeParse({ text: "hello", path: "/tmp/report.md" }).success).toBe(true)
    expect(textFileWriteInputSchema.safeParse({ text: "hello", path: "C:\\Temp\\report.md" }).success).toBe(true)
    expect(textFileWriteInputSchema.safeParse({ text: "hello", path: "relative/report.md" }).success).toBe(false)
  })

  it("accepts arbitrary extensions, extensionless paths, and both encodings", () => {
    expect(textFileWriteInputSchema.safeParse({ text: "{}", path: "/tmp/report.json", encoding: "utf8" }).success).toBe(true)
    expect(textFileWriteInputSchema.safeParse({ text: "key=value", path: "C:\\Temp\\.env", encoding: "utf16le" }).success).toBe(true)
    expect(textFileWriteInputSchema.safeParse({ text: "<h1>x</h1>", path: "/tmp/report.html", encoding: "utf16le" }).success).toBe(true)
    expect(textFileWriteInputSchema.safeParse({ text: "hello", path: "/tmp/README" }).success).toBe(true)
  })
})
