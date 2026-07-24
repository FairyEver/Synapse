import { describe, expect, it } from "vitest"
import {
  clipboardTextReadNodeConfigSchema,
  clipboardTextWriteNodeConfigSchema,
} from "../schema"

describe("Clipboard Workflow config schemas", () => {
  it("requires a valid non-empty raw write template and strict variables", () => {
    expect(clipboardTextWriteNodeConfigSchema.safeParse({
      text: " \n",
      variables: [],
    }).success).toBe(true)
    expect(clipboardTextWriteNodeConfigSchema.safeParse({
      text: "",
      variables: [],
    }).success).toBe(false)
    expect(clipboardTextWriteNodeConfigSchema.safeParse({
      text: "value",
    }).success).toBe(false)
    expect(clipboardTextWriteNodeConfigSchema.safeParse({
      text: "value",
      variables: [],
      extra: true,
    }).success).toBe(false)
  })

  it("accepts only an empty read config object", () => {
    expect(clipboardTextReadNodeConfigSchema.safeParse({}).success).toBe(true)
    expect(clipboardTextReadNodeConfigSchema.safeParse({ extra: true }).success).toBe(false)
  })
})
