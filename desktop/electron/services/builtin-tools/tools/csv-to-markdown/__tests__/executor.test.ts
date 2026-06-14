import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { DEFAULT_FILE_CONVERSION_MAX_BYTES } from "../../../../file-conversion"
import { executeCsvToMarkdown } from "../executor"

describe("csv-to-markdown executor", () => {
  it("rejects non-csv input", async () => {
    await expect(executeCsvToMarkdown({
      inputPath: "/tmp/source.docx",
      outputMode: "return",
      delimiter: ",",
      maxRows: 1000,
    }, { entryPoint: "tools", actor: { kind: "user" } })).rejects.toMatchObject({
      code: "unsupported_input",
    })
  })

  it("converts quoted csv values to a markdown table", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-csv-tool-"))
    const sourcePath = path.join(dir, "people.csv")
    await writeFile(sourcePath, "name,notes\nAlice,\"hello, world\"\nBob,\n")

    const result = await executeCsvToMarkdown({
      inputPath: sourcePath,
      outputMode: "return",
      delimiter: ",",
      maxRows: 100,
    }, { entryPoint: "tools", actor: { kind: "user" } })

    expect(result.markdown).toContain("| name | notes |")
    expect(result.markdown).toContain("| Alice | hello, world |")
    expect(result.markdown).toContain("| Bob |  |")
  })

  it("rejects oversized csv files before parsing rows", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-csv-tool-large-"))
    const sourcePath = path.join(dir, "large.csv")
    await writeFile(sourcePath, "name\nAlice\n")
    await truncate(sourcePath, DEFAULT_FILE_CONVERSION_MAX_BYTES + 1)

    try {
      await expect(executeCsvToMarkdown({
        inputPath: sourcePath,
        outputMode: "return",
        delimiter: ",",
        maxRows: 100,
      }, { entryPoint: "tools", actor: { kind: "user" } })).rejects.toMatchObject({
        code: "read_failed",
        message: "Source file exceeds the conversion size limit.",
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
