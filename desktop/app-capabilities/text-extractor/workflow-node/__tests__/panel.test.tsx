/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { TextExtractNodePanel } from "../panel"

vi.mock("@/lib/ui-tracking", () => ({ track: vi.fn() }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("TextExtractNodePanel", () => {
  it("edits the document path and keeps existing variable bindings", () => {
    const container = document.createElement("div")
    const root = createRoot(container)
    const onChange = vi.fn()
    const variables = [{ name: "source", source: { type: "param" as const, param: "source" } }]

    act(() => {
      root.render(
        <TextExtractNodePanel
          config={{ filePath: "{{source}}", variables }}
          onChange={onChange}
          upstreamNodes={[]}
          workflowParams={[{ name: "source", type: "file", default: null }]}
          projects={[]}
        />,
      )
    })

    const input = container.querySelector<HTMLInputElement>("#text-extract-node-file")
    expect(input?.value).toBe("{{source}}")
    expect(container.querySelector("[data-slot='field-group']")).not.toBeNull()
    expect(container.querySelector("[data-slot='field']")).not.toBeNull()
    expect(container.querySelector("[data-slot='field-label']")).not.toBeNull()

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(input, "/tmp/report.pdf")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith({ filePath: "/tmp/report.pdf", variables })
    act(() => root.unmount())
  })
})
