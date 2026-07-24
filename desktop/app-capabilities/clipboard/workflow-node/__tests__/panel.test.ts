import { describe, expect, it } from "vitest"
import { getPanel } from "../../../../workflow-nodes/panel-registry"
import { ClipboardTextWriteNodePanel } from "../panel"

describe("Clipboard Workflow panels", () => {
  it("registers only the dedicated write panel", () => {
    expect(getPanel("clipboard_text_write")).toBe(ClipboardTextWriteNodePanel)
    expect(getPanel("clipboard_text_read")).toBeUndefined()
  })
})
