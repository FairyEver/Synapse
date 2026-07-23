import { describe, expect, it } from "vitest"
import { textFileWriteInputSchema } from "../schema"

describe("textFileWriteInputSchema", () => {
  it("validates absolute paths without relying on Node path APIs", () => {
    expect(textFileWriteInputSchema.safeParse({ text: "hello", path: "/tmp/report.md" }).success).toBe(true)
    expect(textFileWriteInputSchema.safeParse({ text: "hello", path: "C:\\Temp\\report.md" }).success).toBe(true)
    expect(textFileWriteInputSchema.safeParse({ text: "hello", path: "relative/report.md" }).success).toBe(false)
  })

  it("accepts HTML only with UTF-8 and preserves case-insensitive extensions", () => {
    expect(textFileWriteInputSchema.safeParse({ text: "<h1>x</h1>", path: "/tmp/report.HTML", encoding: "utf8" }).success).toBe(true)
    expect(textFileWriteInputSchema.safeParse({ text: "<h1>x</h1>", path: "C:\\Temp\\report.htm", encoding: "utf8" }).success).toBe(true)
    expect(textFileWriteInputSchema.safeParse({ text: "<h1>x</h1>", path: "/tmp/report.html", encoding: "utf16le" }).success).toBe(false)
  })
})
