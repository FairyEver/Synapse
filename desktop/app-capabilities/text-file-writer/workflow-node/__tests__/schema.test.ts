import path from "node:path"
import { describe, expect, it } from "vitest"
import { textFileWriterNodeManifest } from "../manifest"
import { textFileWriterNodeConfigSchema } from "../schema"

describe("text file writer workflow node schema", () => {
  it("keeps format inferred from the path and rejects extra fields", () => {
    expect(textFileWriterNodeConfigSchema.safeParse({
      path: path.resolve("{{name}}.md"),
      text: "{{body}}",
      encoding: "utf8",
      overwrite: false,
      variables: [],
    }).success).toBe(true)
    expect(textFileWriterNodeConfigSchema.safeParse({
      path: path.resolve("report.md"),
      text: "hello",
      encoding: "utf8",
      overwrite: false,
      variables: [],
      format: "md",
    }).success).toBe(false)
  })

  it("declares the built-in capability and local write resource", () => {
    expect(textFileWriterNodeManifest.share).toMatchObject({
      capability: {
        id: "app.text_file_writer.file.write",
        minVersion: "1.1.0",
      },
      resources: [{ path: ["path"], entryType: "file", cardinality: "one", access: "write" }],
    })
    expect(textFileWriterNodeManifest.configFields.map((field) => field.name)).not.toContain("format")
  })
})
