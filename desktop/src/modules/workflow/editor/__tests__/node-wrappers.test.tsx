/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { NodeProps } from "@xyflow/react"
import { describe, expect, it, vi } from "vitest"
import { nodeTypes } from "../node-wrappers"
import { WorkflowLayoutDirectionProvider } from "../../workflow-layout-direction-context"

const handleCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock("@xyflow/react", () => ({
  Handle: ({ type, position, id, style }: Record<string, unknown>) => {
    handleCalls.push({ type, position, id, style })
    return null
  },
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}))

vi.mock("../node-context-menu", () => ({
  NodeContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
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
    expect(nodeTypes.file_opener_file_open).toBeTypeOf("function")
  })

  it("registers both HTML Generator node cards", () => {
    expect(nodeTypes.html_generator_ejs_generate).toBeTypeOf("function")
    expect(nodeTypes.html_generator_ejs_file_generate).toBeTypeOf("function")
  })

  it("uses product direction for regular and end-node connection points", () => {
    const PromptNode = nodeTypes.prompt
    const EndNode = nodeTypes.end

    handleCalls.length = 0
    renderToStaticMarkup(
      <WorkflowLayoutDirectionProvider value="vertical">
        <PromptNode {...nodeProps("prompt", { name: "Prompt", prompt: "", variables: [] })} />
        <EndNode {...nodeProps("end", { name: "End", outputType: "text", template: "", variables: [] })} />
      </WorkflowLayoutDirectionProvider>,
    )

    expect(handleCalls).toEqual([
      expect.objectContaining({ type: "target", position: "top" }),
      expect.objectContaining({ type: "source", position: "bottom" }),
      expect.objectContaining({ type: "target", position: "top" }),
    ])
  })

  it("keeps vertical Switch branch IDs in config order along the bottom edge", () => {
    const SwitchNode = nodeTypes.switch
    handleCalls.length = 0

    const markup = renderToStaticMarkup(
      <WorkflowLayoutDirectionProvider value="vertical">
        <SwitchNode {...nodeProps("switch", {
          name: "Switch",
          branches: [
            { id: "branch-a", label: "A" },
            { id: "branch-b", label: "B" },
          ],
        })} />
      </WorkflowLayoutDirectionProvider>,
    )

    expect(handleCalls).toEqual([
      expect.objectContaining({ type: "target", position: "top" }),
      expect.objectContaining({
        type: "source",
        position: "bottom",
        id: "branch-a",
        style: { left: "33.33333333333333%" },
      }),
      expect.objectContaining({
        type: "source",
        position: "bottom",
        id: "branch-b",
        style: { left: "66.66666666666666%" },
      }),
    ])
    expect(markup).toContain("width:220px")
  })
})

function nodeProps(id: string, data: Record<string, unknown>): NodeProps {
  return {
    id,
    data,
    selected: false,
    type: id,
    zIndex: 0,
    isConnectable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
    draggable: false,
    selectable: true,
    deletable: false,
  } as unknown as NodeProps
}
