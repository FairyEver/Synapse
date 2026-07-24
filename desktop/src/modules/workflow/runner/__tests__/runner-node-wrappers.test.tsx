/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import type { NodeProps } from "@xyflow/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { NodeRunResult } from "@/types/workflow"
import type { SynapseAgentConversationReference } from "@/types/agent-navigation"
import {
  RunnerOpenAgentConversationContext,
  RunnerNodeResultsContext,
  runnerNodeTypes,
} from "../runner-node-wrappers"
import { WorkflowLayoutDirectionProvider } from "../../workflow-layout-direction-context"

const handleCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock("@xyflow/react", () => ({
  Handle: ({ type, position, id, style }: Record<string, unknown>) => {
    handleCalls.push({ type, position, id, style })
    return null
  },
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}))

vi.mock("../../../../workflow-nodes/provider-lookup-context", () => ({
  useProviderLookup: () => ({
    getModelName: () => undefined,
    getModelDisplayName: () => undefined,
    getProviderName: () => undefined,
  }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots.length = 0
  document.body.innerHTML = ""
})

describe("runnerNodeTypes", () => {
  it("renders the text node card instead of falling back to an empty default node", async () => {
    const TextNode = runnerNodeTypes.text
    expect(TextNode).toBeTypeOf("function")

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <RunnerNodeResultsContext.Provider value={{}}>
          <TextNode
            id="node_text"
            data={{ name: "公共：作业 JSON 写作规范", template: "写作规范", variables: [] }}
            selected={false}
            type="text"
            zIndex={0}
            isConnectable={false}
            positionAbsoluteX={0}
            positionAbsoluteY={0}
            dragging={false}
            draggable={false}
            selectable
            deletable={false}
          />
        </RunnerNodeResultsContext.Provider>,
      )
    })

    expect(container.textContent).toContain("公共：作业 JSON 写作规范")
    expect(container.textContent).toContain("写作规范")
  })

  it("registers the document template node type", () => {
    expect(runnerNodeTypes.document_template_docx_generate).toBeTypeOf("function")
  })

  it("registers the text extraction node type", () => {
    expect(runnerNodeTypes.text_extract).toBeTypeOf("function")
  })

  it("registers the default-app open-file node type", () => {
    expect(runnerNodeTypes.file_opener_file_open).toBeTypeOf("function")
  })

  it("registers both HTML Generator runner cards", () => {
    expect(runnerNodeTypes.html_generator_ejs_generate).toBeTypeOf("function")
    expect(runnerNodeTypes.html_generator_ejs_file_generate).toBeTypeOf("function")
  })

  it("matches editor semantics for vertical Switch connection points", () => {
    const SwitchNode = runnerNodeTypes.switch
    handleCalls.length = 0

    const markup = renderToStaticMarkup(
      <WorkflowLayoutDirectionProvider value="vertical">
        <RunnerNodeResultsContext.Provider value={{}}>
          <SwitchNode {...nodeProps("switch", {
            name: "Switch",
            branches: [
              { id: "branch-a", label: "A" },
              { id: "branch-b", label: "B" },
            ],
          })} />
        </RunnerNodeResultsContext.Provider>
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

  it("opens the agent conversation directly from a DAG node card", async () => {
    const target: SynapseAgentConversationReference = {
      projectId: "project-1",
      conversationId: "conversation-1",
      platform: "workflow",
    }
    const onOpenAgentConversation = vi.fn()
    const PromptNode = runnerNodeTypes.prompt
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <RunnerOpenAgentConversationContext.Provider value={onOpenAgentConversation}>
          <RunnerNodeResultsContext.Provider value={{ node_1: nodeResult("node_1", target) }}>
            <PromptNode
              id="node_1"
              data={{ name: "生成总结", providerId: "provider-1", prompt: "run" }}
              selected={false}
              type="prompt"
              zIndex={0}
              isConnectable={false}
              positionAbsoluteX={0}
              positionAbsoluteY={0}
              dragging={false}
              draggable={false}
              selectable
              deletable={false}
            />
          </RunnerNodeResultsContext.Provider>
        </RunnerOpenAgentConversationContext.Provider>,
      )
    })

    const button = container.querySelector<HTMLButtonElement>("button[aria-label='打开对话']")
    expect(button).not.toBeNull()
    expect(button?.dataset.size).toBe("icon-sm")
    expect(button?.className).toContain("absolute -right-3 -top-3")
    expect(button?.className).toContain("rounded-full")
    expect(button?.className).toContain("p-1")
    expect(button?.querySelector("svg")?.className.baseVal).toContain("size-3")

    await act(async () => {
      button?.click()
    })

    expect(onOpenAgentConversation).toHaveBeenCalledWith(target)
  })
})

function nodeResult(nodeId: string, target: SynapseAgentConversationReference): NodeRunResult {
  return {
    nodeId,
    status: "success",
    input: { variables: {} },
    outputs: { agentConversation: target },
  }
}

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
