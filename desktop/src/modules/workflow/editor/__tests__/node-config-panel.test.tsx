import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition } from "@/types/workflow"

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    className,
  }: {
    readonly children: ReactNode
    readonly className?: string
  }) => <div data-slot="scroll-area" className={className}>{children}</div>,
}))

vi.mock("../../../../workflow-nodes/panel-registry", () => ({
  getPanel: () => function TestPanel() {
    return <div>节点配置</div>
  },
}))

vi.mock("../../../../workflow-nodes/registry", () => ({
  nodeTypeRegistry: {
    getManifest: () => ({
      title: "Prompt",
      icon: () => <span data-testid="node-icon" />,
    }),
  },
}))

vi.mock("../../../../workflow-nodes/provider-lookup-context", () => ({
  useProviderLookup: () => ({
    getProviderName: () => undefined,
    getModelName: () => undefined,
    getModelDisplayName: () => undefined,
    isProviderAvailable: () => true,
  }),
}))

vi.mock("../hooks/use-upstream-nodes", () => ({
  useUpstreamNodes: () => [],
}))

vi.mock("../components/params-editor-dialog", () => ({
  ParamsEditorDialog: () => null,
}))

vi.mock("@/components/provider-model-select-dialog", () => ({
  ProviderModelSelectDialog: () => null,
}))

import { NodeConfigPanel } from "../node-config-panel"

const definition: WorkflowDefinition = {
  id: "workflow-1",
  name: "Workflow",
  version: "v1",
  createdAt: 0,
  updatedAt: 0,
  nodes: [
    {
      id: "prompt-1",
      name: "Prompt",
      type: "prompt",
      position: { x: 0, y: 0 },
      config: { prompt: "Hello", variables: [] },
    },
  ],
  edges: [],
  params: [],
}

describe("NodeConfigPanel", () => {
  it("keeps selected-node padding inside the scroll content", () => {
    const html = renderToStaticMarkup(
      <NodeConfigPanel
        nodeId="prompt-1"
        definition={definition}
        projects={[]}
        onConfigChange={() => undefined}
        onNameChange={() => undefined}
      />,
    )

    expect(html).not.toContain('data-slot="scroll-area" class="flex-1 p-3"')
    expect(html).toContain('class="p-3"')
  })

  it("keeps workflow settings padding inside the scroll content", () => {
    const html = renderToStaticMarkup(
      <NodeConfigPanel
        nodeId={null}
        definition={definition}
        projects={[]}
        onConfigChange={() => undefined}
        onNameChange={() => undefined}
      />,
    )

    expect(html).not.toContain('data-slot="scroll-area" class="flex-1 p-3"')
    expect(html).toContain('class="space-y-4 p-3"')
  })
})
