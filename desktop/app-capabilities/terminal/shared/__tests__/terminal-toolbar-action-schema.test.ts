import { describe, expect, it } from "vitest"

import {
  TERMINAL_CUSTOM_TOOLBAR_ACTION_CONTENT_MAX_LENGTH,
  TERMINAL_CUSTOM_TOOLBAR_ACTION_LABEL_MAX_LENGTH,
  terminalCreateCustomToolbarActionInputSchema,
} from "../schema"

describe("terminal custom toolbar action schema", () => {
  it("normalizes a valid single-line action", () => {
    expect(terminalCreateCustomToolbarActionInputSchema.parse({
      label: "  检查状态  ",
      content: "  git status  ",
      pressEnter: true,
    })).toEqual({
      label: "检查状态",
      content: "git status",
      pressEnter: true,
    })
  })

  it("rejects blank, multi-line, and oversized values", () => {
    expect(terminalCreateCustomToolbarActionInputSchema.safeParse({
      label: " ",
      content: "git status",
      pressEnter: true,
    }).success).toBe(false)
    expect(terminalCreateCustomToolbarActionInputSchema.safeParse({
      label: "检查状态",
      content: "git status\ngit branch",
      pressEnter: true,
    }).success).toBe(false)
    expect(terminalCreateCustomToolbarActionInputSchema.safeParse({
      label: "x".repeat(TERMINAL_CUSTOM_TOOLBAR_ACTION_LABEL_MAX_LENGTH + 1),
      content: "git status",
      pressEnter: true,
    }).success).toBe(false)
    expect(terminalCreateCustomToolbarActionInputSchema.safeParse({
      label: "检查状态",
      content: "x".repeat(TERMINAL_CUSTOM_TOOLBAR_ACTION_CONTENT_MAX_LENGTH + 1),
      pressEnter: true,
    }).success).toBe(false)
  })
})
