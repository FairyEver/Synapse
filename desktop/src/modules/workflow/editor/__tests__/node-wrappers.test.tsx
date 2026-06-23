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
  it("registers the document template node type", () => {
    expect(nodeTypes.document_template_docx_generate).toBeTypeOf("function")
  })
})
