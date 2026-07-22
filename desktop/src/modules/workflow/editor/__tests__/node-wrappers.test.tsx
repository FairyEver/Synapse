import { describe, expect, it, vi } from "vitest"
import { nodeTypes } from "../node-wrappers"

vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
}))

vi.mock("../../../../workflow-nodes/provider-lookup-context", () => ({
  useProviderLookup: () => ({
    getModelName: () => undefined,
    getModelDisplayName: () => undefined,
    getProviderName: () => undefined,
  }),
}))

describe("nodeTypes", () => {
  it("registers the text node type", () => {
    expect(nodeTypes.text).toBeTypeOf("function")
  })

  it("registers the document template node type", () => {
    expect(nodeTypes.document_template_docx_generate).toBeTypeOf("function")
  })

  it("registers the text extraction node type", () => {
    expect(nodeTypes.text_extract).toBeTypeOf("function")
  })

  it("registers the default-app open-file node type", () => {
    expect(nodeTypes.open_file).toBeTypeOf("function")
  })
})
